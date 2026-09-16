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

/**
 * Cuánto se considera "fresca" una signed URL ya resuelta, para poder
 * reusarla entre sesiones sin pedir una nueva ni volver a bajar la foto.
 * Un margen de 5 min por debajo de `SIGNED_URL_TTL` evita que se use
 * hasta el borde y expire mientras la imagen sigue en pantalla.
 *
 * Real: el token de la signed URL cambia en cada llamada a `createSignedUrl(s)`,
 * aunque sea la misma foto — eso hace que el navegador la trate como un
 * recurso distinto y la vuelva a descargar completa, aunque ya la tuviera en
 * caché. Reusar la MISMA url (con su mismo token) mientras siga vigente deja
 * que el caché HTTP del navegador la sirva sin generar egress nuevo. Medido
 * como causa real de un pico de egress en Supabase (7-8 sep 2026, ver
 * `docs/CONTINUAR-BACKEND.md`).
 */
const SIGNED_URL_FRESH_MS = (SIGNED_URL_TTL - 5 * 60) * 1000

/** ¿Sigue vigente (con margen) una signed URL resuelta en `at` (epoch ms)? */
export function isSignedUrlFresh(at: number | undefined): boolean {
  return !!at && Date.now() - at < SIGNED_URL_FRESH_MS
}

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

/**
 * Miniatura transformada (200×200, calidad 60) de cada foto — pedido de
 * Andrés: "¿se puede hacer que la carga de cuadrantes con muchas fotos sea
 * un poco más rápida?". Confirmado contra el bucket real: una foto de
 * ~380KB (1600px, la que ya deja `compressImage`) baja a ~9KB con esta
 * transformación — con 100+ fotos por cuadrante es la diferencia entre
 * bajar ~1MB o ~40MB. `createSignedUrls` (plural) NO soporta `transform`
 * en la API de Storage (probado directo contra el bucket: el `transform`
 * se ignora en el endpoint en lote) — solo el endpoint de una foto a la
 * vez lo acepta, así que esto pide una signed URL por foto en paralelo
 * (siguen siendo requests livianos, la ganancia real está en los bytes de
 * imagen que ya no hay que bajar).
 */
export async function getSignedUrlsThumb(
  paths: string[],
  expiresIn: number = SIGNED_URL_TTL,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (paths.length === 0) return map
  const results = await Promise.all(paths.map(async (path) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn, {
      transform: { width: 200, height: 200, resize: 'cover', quality: 60 },
    })
    if (error) {
      console.error(`[photoStorage] signedUrlThumb(${path}):`, error.message)
      return null
    }
    return [path, data.signedUrl] as const
  }))
  for (const r of results) if (r) map.set(r[0], r[1])
  return map
}

/** Borra objetos del bucket. No falla si la lista viene vacía. */
export async function removePhotoObjects(paths: (string | undefined | null)[]): Promise<void> {
  const clean = paths.filter((p): p is string => !!p)
  if (clean.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(clean)
  if (error) throw new Error(`storage.remove: ${error.message}`)
}
