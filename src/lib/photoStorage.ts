// Operaciones genéricas sobre el bucket privado `fotos` de Supabase Storage,
// compartidas por todos los módulos (att, preventivos, ...). Cada módulo
// mantiene su propia orquestación (`uploadRecordPhotos`) que sabe recorrer
// su propio tipo de record y arma las rutas con su propio prefijo
// (`att/{blobId}.jpg`, `preventivos/{blobId}.jpg`, ...).
//
// El bucket es privado y sus políticas de Storage solo exigen sesión
// (auth.uid() not null); no filtran por path, así que el path es libre. El
// control de acceso real está en la tabla de fotos/puntos de cada módulo.

import { supabase } from './supabaseClient'

const BUCKET = 'fotos'
/** Vigencia de las signed URLs (segundos). 1 h basta para ver/editar un informe. */
const SIGNED_URL_TTL = 60 * 60

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
