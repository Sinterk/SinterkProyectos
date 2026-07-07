// Capa de fotos → Supabase Storage (bucket privado `fotos`).
//
// Complementa a `attRepo` (que solo persiste filas de `fotos` con `storagePath`):
// aquí vive la subida del blob y la resolución de signed URLs para leerlas.
//
// Rutas: `att/{blobId}.jpg`. Se usa el `blobId` (nanoid ya asignado al capturar,
// ver `useAtt`) para que la subida no dependa de que el informe exista aún en la
// BD. El bucket es privado y sus políticas de Storage solo exigen sesión
// (auth.uid() not null); no filtran por path, así que el path es libre. El
// control de acceso real está en la tabla `fotos` (RLS `can_edit_informe`).

import { supabase } from '@/lib/supabaseClient'
import { getPhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import type { AttRecord, FotoEntry } from '../types'

const BUCKET = 'fotos'
/** Vigencia de las signed URLs (segundos). 1 h basta para ver/editar un informe. */
const SIGNED_URL_TTL = 60 * 60

/** Ruta determinista de un blob en el bucket. */
function storagePathFor(blobId: string | undefined): string {
  return `att/${blobId ?? nanoid()}.jpg`
}

// ---------------------------------------------------------------------------
// Operaciones de bucket (bajo nivel)
// ---------------------------------------------------------------------------

/** Sube un blob al bucket (upsert). Devuelve el path guardado. */
export async function uploadPhotoObject(path: string, blob: Blob): Promise<string> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true,
  })
  if (error) throw new Error(`storage.upload(${path}): ${error.message}`)
  return path
}

/** Signed URL de un objeto. `null` si falla (p. ej. el objeto ya no existe). */
export async function getSignedUrl(
  path: string,
  expiresIn: number = SIGNED_URL_TTL,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (error) {
    console.error(`[photoStorage] signedUrl(${path}):`, error.message)
    return null
  }
  return data.signedUrl
}

/** Signed URLs en lote → Map<path, url> (omite las que fallen). */
export async function getSignedUrls(
  paths: string[],
  expiresIn: number = SIGNED_URL_TTL,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (paths.length === 0) return map
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn)
  if (error) {
    console.error('[photoStorage] signedUrls:', error.message)
    return map
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl)
  }
  return map
}

/** Borra objetos del bucket. No falla si la lista viene vacía. */
export async function removePhotoObjects(paths: (string | undefined | null)[]): Promise<void> {
  const clean = paths.filter((p): p is string => !!p)
  if (clean.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(clean)
  if (error) throw new Error(`storage.remove: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Orquestación sobre un AttRecord (para el flujo de guardado — paso 3)
// ---------------------------------------------------------------------------

/**
 * Sube a Storage los blobs locales del record que aún no estén subidos y
 * devuelve un record nuevo con `storagePath` poblado en cada foto subida.
 * No toca la base de datos: es el paso previo a `attRepo.save` (que solo
 * persiste fotos con `storagePath`).
 *
 * - foto con `storagePath` → ya en Storage, se deja igual.
 * - foto con `blobId` sin subir → lee el blob de IndexedDB y lo sube.
 * - foto sin blob ni path → se deja igual (nada que subir).
 */
export async function uploadRecordPhotos(record: AttRecord): Promise<AttRecord> {
  async function ensureUploaded(f: FotoEntry): Promise<FotoEntry> {
    if (f.storagePath) return f
    if (!f.blobId) return f
    const entry = await getPhotoBlob(f.blobId)
    if (!entry) {
      console.warn(`[photoStorage] blob ${f.blobId} no está en IndexedDB; se omite`)
      return f
    }
    const path = storagePathFor(f.blobId)
    await uploadPhotoObject(path, entry.blob)
    return { ...f, storagePath: path }
  }

  const fotos = await Promise.all(record.fotos.map(ensureUploaded))
  const fotoAerea = record.fotoAerea ? await ensureUploaded(record.fotoAerea) : undefined
  return { ...record, fotos, fotoAerea }
}
