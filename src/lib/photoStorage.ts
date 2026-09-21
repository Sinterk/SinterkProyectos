// Operaciones genéricas sobre el bucket de fotos, compartidas por todos los
// módulos (att, preventivos, ...). Cada módulo mantiene su propia
// orquestación (`uploadRecordPhotos`) que sabe recorrer su propio tipo de
// record y arma las rutas con su propio prefijo (`att/{blobId}.jpg`,
// `preventivos/{blobId}.jpg`, ...).
//
// Migrado de Supabase Storage a Cloudflare R2 (egress $0, ver
// docs/CONTINUAR-BACKEND.md — el plan gratis de Supabase se pasó del
// límite de egress por el peso de las fotos). R2 no tiene el equivalente a
// las políticas RLS de Storage, así que firmar una URL (subir o bajar) o
// borrar un objeto pasa por la Edge Function `r2-storage`, que sí puede
// tener las claves de R2 sin exponerlas al navegador — mismo patrón que
// `crear-usuario` con la service_role key. El nivel de acceso es el mismo
// que tenía el bucket de Supabase Storage: cualquier sesión válida, sin
// filtrar por rol ni por path (el control real sigue en las tablas de cada
// módulo, no en el storage).

import { supabase } from './supabaseClient'

const FUNCTION_NAME = 'r2-storage'
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

interface SignResponse { urls: Record<string, string> }

/** Invoca la Edge Function `r2-storage` (ver su comentario) y devuelve su body ya parseado. */
async function callR2<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body })
  if (error) throw new Error(`r2-storage: ${error.message}`)
  if (data?.error) throw new Error(`r2-storage: ${data.error}`)
  return data as T
}

/** Sube un blob a R2 vía una URL de subida prefirmada (la Edge Function nunca ve los bytes de la foto). */
export async function uploadPhotoObject(path: string, blob: Blob): Promise<string> {
  const { urls } = await callR2<SignResponse>({ action: 'sign-put', paths: [path] })
  const url = urls[path]
  if (!url) throw new Error(`r2.upload(${path}): no se pudo firmar la subida`)
  const res = await fetch(url, { method: 'PUT', body: blob })
  if (!res.ok) throw new Error(`r2.upload(${path}): HTTP ${res.status}`)
  return path
}

/** Signed URL de un objeto. `null` si falla (p. ej. el objeto ya no existe). */
export async function getSignedUrl(
  path: string,
  expiresIn: number = SIGNED_URL_TTL,
): Promise<string | null> {
  const map = await getSignedUrls([path], expiresIn)
  return map.get(path) ?? null
}

/** Signed URLs en lote → Map<path, url> (omite las que fallen). */
export async function getSignedUrls(
  paths: string[],
  expiresIn: number = SIGNED_URL_TTL,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (paths.length === 0) return map
  try {
    const { urls } = await callR2<SignResponse>({ action: 'sign-get', paths, expiresIn })
    for (const [path, url] of Object.entries(urls)) map.set(path, url)
  } catch (err) {
    console.error('[photoStorage] signedUrls:', err)
  }
  return map
}

/**
 * Borra objetos del bucket. No falla si la lista viene vacía.
 *
 * R2 no tiene el transform-al-vuelo que tenía Supabase Storage (ver el
 * viejo `getSignedUrlsThumb`, retirado de acá) — la miniatura de cada foto
 * ahora es un objeto real, generado y subido aparte al capturar la foto
 * (ver `ensureUploaded`/`thumbPathFor` en preventivos/data/photoStorage.ts,
 * el único módulo que usa miniaturas). Por eso vive ahí el wrapper que
 * borra también la miniatura de cada foto, no acá.
 */
export async function removePhotoObjects(paths: (string | undefined | null)[]): Promise<void> {
  const clean = paths.filter((p): p is string => !!p)
  if (clean.length === 0) return
  await callR2<{ ok: true }>({ action: 'delete', paths: clean })
}
