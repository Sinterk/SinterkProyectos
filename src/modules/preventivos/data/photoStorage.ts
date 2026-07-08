// Orquestación de fotos → Storage específica de Preventivos. Las operaciones
// de bucket (subir/firmar/borrar) son genéricas y viven en `@/lib/photoStorage`,
// compartidas con otros módulos (att, ...).
//
// Rutas: `preventivos/{blobId}.jpg`. Un Preventivo tiene hasta 1 + 3*N fotos:
// la del plano (cuadrante.fotoPlano) y hasta 3 por punto (levantamiento/antes/después).

import { getPhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import { uploadPhotoObject } from '@/lib/photoStorage'
import type { Preventivo, FotoEntry } from '../types'

export { getSignedUrl, getSignedUrls, removePhotoObjects } from '@/lib/photoStorage'

function storagePathFor(blobId: string | undefined): string {
  return `preventivos/${blobId ?? nanoid()}.jpg`
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

async function ensureUploadedOrUndefined(f: FotoEntry | undefined): Promise<FotoEntry | undefined> {
  return f ? ensureUploaded(f) : undefined
}

/**
 * Sube a Storage los blobs locales del record que aún no estén subidos y
 * devuelve un record nuevo con `storagePath` poblado en cada foto subida.
 * No toca la base de datos: es el paso previo a `preventivoRepo.save`.
 */
export async function uploadRecordPhotos(record: Preventivo): Promise<Preventivo> {
  const fotoPlano = await ensureUploadedOrUndefined(record.cuadrante.fotoPlano)
  const puntos = await Promise.all(record.puntos.map(async (p) => ({
    ...p,
    fotoLevantamiento: await ensureUploadedOrUndefined(p.fotoLevantamiento),
    fotoAntes: await ensureUploadedOrUndefined(p.fotoAntes),
    fotoDespues: await ensureUploadedOrUndefined(p.fotoDespues),
  })))
  return { ...record, cuadrante: { ...record.cuadrante, fotoPlano }, puntos }
}
