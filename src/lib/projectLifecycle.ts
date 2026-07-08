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

/**
 * Borra un proyecto (el cascade arrastra sus hijos, sea cual sea el área).
 * La RLS reserva el DELETE al rol `admin`: para cualquier otro rol, Postgres
 * no arroja error, simplemente afecta 0 filas. Se detecta con `.select()`
 * (devuelve las filas realmente borradas) y se lanza un error explícito en
 * vez de fallar en silencio.
 */
export async function removeProject(id: string): Promise<void> {
  if (!isUuid(id)) return
  const { data, error } = await supabase.from('projects').delete().eq('id', id).select('id')
  if (error) throw new Error(`projects.delete: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No tienes permiso para eliminar este informe (requiere rol admin).')
  }
}

/**
 * "Cierra" un proyecto (estado=cerrado + fecha_cierre) en vez de borrarlo.
 * Vía para jp/invitado, a quienes la RLS sí deja hacer UPDATE. Mismo chequeo
 * de 0 filas afectadas que `removeProject`, por si el rol tampoco alcanza.
 */
export async function closeProject(id: string): Promise<void> {
  if (!isUuid(id)) return
  const { data, error } = await supabase
    .from('projects')
    .update({ estado: 'cerrado', fecha_cierre: todayISO() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(`projects.close: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No tienes permiso para cerrar este informe.')
  }
}
