// Orquestación de fotos → Storage específica de Preventivos. Las operaciones
// de bucket (subir/firmar/borrar) son genéricas y viven en `@/lib/photoStorage`,
// compartidas con otros módulos (att, ...).
//
// Rutas: `preventivos/{blobId}.jpg`. Un Preventivo tiene hasta 1 + 3*N fotos:
// la del plano (cuadrante.fotoPlano) y hasta 3 por punto (levantamiento/antes/después).

import { getPhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import { compressImage } from '@/core/utils/compressImage'
import {
  uploadPhotoObject,
  getSignedUrls,
  removePhotoObjects as removePhotoObjectsBase,
} from '@/lib/photoStorage'
import type { Preventivo, FotoEntry } from '../types'

export { getSignedUrl, getSignedUrls, isSignedUrlFresh } from '@/lib/photoStorage'

function storagePathFor(blobId: string | undefined): string {
  return `preventivos/${blobId ?? nanoid()}.jpg`
}

/**
 * Ruta de la miniatura de una foto ya subida — un objeto real aparte, no un
 * transform al vuelo (R2 no lo tiene, a diferencia de Supabase Storage). Se
 * deriva del path original en vez de guardarse en `FotoEntry`: no hace
 * falta persistir nada nuevo, y borrar/mover la original implica lo mismo
 * para su miniatura sin tener que arrastrar un campo aparte.
 */
function thumbPathFor(path: string): string {
  return path.replace(/^preventivos\//, 'preventivos/thumbs/')
}

/**
 * Ruta de la versión "informe" de una foto — mismo mecanismo que
 * `thumbPathFor`. Pedido de Andrés al revisar si generar el Informe Entel
 * bajaba fotos de más: `generarInformeEntel.ts` descargaba la foto completa
 * (hasta 1600px, ~350-400KB) solo para reducirla a ~900px al incrustarla en
 * el Excel (el marco es chico). Esta versión (~1000px, calidad 80) alcanza
 * de sobra para ese tamaño de incrustación, bajando el peso del informe a
 * la mitad o menos sin pérdida visible.
 */
function informePathFor(path: string): string {
  return path.replace(/^preventivos\//, 'preventivos/informe/')
}

/**
 * Miniaturas (200px, calidad 60) — pedido de Andrés: "¿se puede hacer que
 * la carga de cuadrantes con muchas fotos sea un poco más rápida?". Con R2
 * no hay transform al vuelo, así que la miniatura se genera y sube como
 * objeto aparte al momento de subir la foto (`ensureUploaded`) — acá solo
 * se piden las signed URLs de esos objetos ya existentes.
 */
export async function getSignedUrlsThumb(
  paths: string[],
  expiresIn?: number,
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const thumbUrls = await getSignedUrls(paths.map(thumbPathFor), expiresIn)
  const map = new Map<string, string>()
  for (const path of paths) {
    const u = thumbUrls.get(thumbPathFor(path))
    if (u) map.set(path, u)
  }
  return map
}

/**
 * Signed URLs de la versión "informe" (ver `informePathFor`) — usadas solo
 * por `generarInformeEntel.ts`. Si una foto no tiene esta versión (p. ej. no
 * se ha vuelto a correr la migración), el llamador debe caer de vuelta a
 * `previewUrl` — acá simplemente se omite del Map, no se lanza error.
 */
export async function getSignedUrlsInforme(
  paths: string[],
  expiresIn?: number,
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const informeUrls = await getSignedUrls(paths.map(informePathFor), expiresIn)
  const map = new Map<string, string>()
  for (const path of paths) {
    const u = informeUrls.get(informePathFor(path))
    if (u) map.set(path, u)
  }
  return map
}

/** Borra cada foto Y sus versiones derivadas (miniatura + informe). */
export async function removePhotoObjects(paths: (string | undefined | null)[]): Promise<void> {
  const clean = paths.filter((p): p is string => !!p)
  await removePhotoObjectsBase(clean.flatMap((p) => [p, thumbPathFor(p), informePathFor(p)]))
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
  const [thumb, informe] = await Promise.all([
    compressImage(entry.blob, 200, 0.6),
    compressImage(entry.blob, 1000, 0.8),
  ])
  await Promise.all([
    uploadPhotoObject(path, entry.blob),
    uploadPhotoObject(thumbPathFor(path), thumb),
    uploadPhotoObject(informePathFor(path), informe),
  ])
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
