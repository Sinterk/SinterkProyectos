// Orquestación de fotos → Storage específica de Incidencias. Las operaciones
// de bucket (subir/firmar/borrar) son genéricas y viven en `@/lib/photoStorage`,
// compartidas con otros módulos (att, preventivos, ...).
//
// Rutas: `incidencias/{blobId}.jpg`.

import { getPhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import { uploadPhotoObject } from '@/lib/photoStorage'
import type { Incidencia, FotoEntry } from '../types'

export { getSignedUrl, getSignedUrls, removePhotoObjects } from '@/lib/photoStorage'

function storagePathFor(blobId: string | undefined): string {
  return `incidencias/${blobId ?? nanoid()}.jpg`
}

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

/**
 * Sube a Storage los blobs locales del record que aún no estén subidos y
 * devuelve un record nuevo con `storagePath` poblado en cada foto subida.
 * No toca la base de datos: es el paso previo a `incidenciaRepo.save`.
 */
export async function uploadRecordPhotos(record: Incidencia): Promise<Incidencia> {
  const fotos = await Promise.all(record.fotos.map(ensureUploaded))
  return { ...record, fotos }
}
