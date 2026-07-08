// Orquestación de fotos → Storage específica de ATT. Las operaciones de
// bucket (subir/firmar/borrar) son genéricas y viven en `@/lib/photoStorage`,
// compartidas con otros módulos (preventivos, ...).
//
// Rutas: `att/{blobId}.jpg`. Se usa el `blobId` (nanoid ya asignado al capturar,
// ver `useAtt`) para que la subida no dependa de que el informe exista aún en la
// BD.

import { getPhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import { uploadPhotoObject } from '@/lib/photoStorage'
import type { AttRecord, FotoEntry } from '../types'

export { getSignedUrl, getSignedUrls, removePhotoObjects } from '@/lib/photoStorage'

/** Ruta determinista de un blob en el bucket. */
function storagePathFor(blobId: string | undefined): string {
  return `att/${blobId ?? nanoid()}.jpg`
}

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
