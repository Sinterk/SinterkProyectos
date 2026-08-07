// Borrar/cerrar un `projects` — igual para cualquier área (att, preventivos, ...),
// porque la RLS de `projects` no depende del área: DELETE reservado a admin,
// UPDATE (para cerrar) permitido a jp/admin. Se comparte para no duplicar el
// chequeo de "0 filas afectadas" (ver abajo) en cada repo de módulo.

import { supabase } from './supabaseClient'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// `getSession()` de supabase-js refresca el token solo si ya venció (usa el
// refresh token guardado) antes de devolver la sesión — llamarla justo antes
// de un DELETE/UPDATE sensible a RLS evita el caso real donde el timer de
// `autoRefreshToken` no alcanzó a correr (ej. pestaña en segundo plano un
// rato largo) y la escritura sale con un token vencido: la RLS la rechaza
// silenciosamente (0 filas), y sin esto el único síntoma visible era un
// mensaje de "te falta el rol admin" que en realidad no tenía que ver con
// el rol — bug real reportado por Andrés (tenía rol admin y aun así no podía
// borrar un informe).
async function refrescarSesion(): Promise<void> {
  try { await supabase.auth.getSession() } catch { /* best-effort, la llamada real de abajo igual va a fallar si algo sigue mal */ }
}

/**
 * Borra un proyecto (el cascade arrastra sus hijos, sea cual sea el área).
 * La RLS reserva el DELETE al rol `admin`: para cualquier otro rol, Postgres
 * no arroja error, simplemente afecta 0 filas. Se detecta con `.select()`
 * (devuelve las filas realmente borradas) y se lanza un error explícito en
 * vez de fallar en silencio.
 */
export async function removeProject(id: string): Promise<void> {
  if (!isUuid(id)) return
  await refrescarSesion()
  const { data, error } = await supabase.from('projects').delete().eq('id', id).select('id')
  if (error) throw new Error(`projects.delete: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No se pudo eliminar (0 filas afectadas): el informe ya no existe en el servidor (lo más probable si aparecía en la lista de este dispositivo pero fue borrado desde otro lado), o te falta el rol admin, o tu sesión quedó vencida. Vuelve a la lista y recárgala — si ya no está allá, era una copia vieja en caché de este dispositivo.')
  }
}

/**
 * "Cierra" un proyecto (estado=cerrado + fecha_cierre) en vez de borrarlo.
 * Vía para jp/invitado, a quienes la RLS sí deja hacer UPDATE. Mismo chequeo
 * de 0 filas afectadas que `removeProject`, por si el rol tampoco alcanza.
 */
export async function closeProject(id: string): Promise<void> {
  if (!isUuid(id)) return
  await refrescarSesion()
  const { data, error } = await supabase
    .from('projects')
    .update({ estado: 'cerrado', fecha_cierre: todayISO() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(`projects.close: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No se pudo cerrar (0 filas afectadas) — puede ser que te falte el permiso, o que tu sesión haya quedado vencida. Prueba cerrar sesión y volver a entrar.')
  }
}

/** Reabre un proyecto cerrado (estado=activo, sin fecha_cierre). Misma RLS que `closeProject` (jp/admin). */
export async function reopenProject(id: string): Promise<void> {
  if (!isUuid(id)) return
  await refrescarSesion()
  const { data, error } = await supabase
    .from('projects')
    .update({ estado: 'activo', fecha_cierre: null })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(`projects.reopen: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No se pudo reabrir (0 filas afectadas) — puede ser que te falte el permiso, o que tu sesión haya quedado vencida. Prueba cerrar sesión y volver a entrar.')
  }
}
