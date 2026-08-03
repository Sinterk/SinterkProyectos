// Capa de datos de sugerencias/reportes de mejora — ver
// src/lib/sugerencias/types.ts y supabase/migrations/0041_sugerencias.sql.

import { supabase } from '../supabaseClient'
import type { CrearSugerenciaInput, Sugerencia, SugerenciaEstado } from './types'

interface SugerenciaRow {
  id: string
  usuario_id: string
  asunto: string
  cuerpo: string
  estado: SugerenciaEstado
  created_at: string
  profiles: { nombre: string | null; email: string | null } | null
}

function sugerenciaFromRow(r: SugerenciaRow): Sugerencia {
  return {
    id: r.id,
    usuarioId: r.usuario_id,
    usuarioNombre: r.profiles?.nombre ?? null,
    usuarioEmail: r.profiles?.email ?? null,
    asunto: r.asunto,
    cuerpo: r.cuerpo,
    estado: r.estado,
    createdAt: r.created_at,
  }
}

/** admin/jp/log ven todas (RLS); el resto solo las propias. */
export async function listSugerencias(): Promise<Sugerencia[]> {
  const { data, error } = await supabase
    .from('sugerencias')
    .select('*, profiles(nombre, email)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`sugerencias.list: ${error.message}`)
  return (data as SugerenciaRow[]).map(sugerenciaFromRow)
}

export async function crearSugerencia(input: CrearSugerenciaInput): Promise<void> {
  const { error } = await supabase.from('sugerencias').insert({
    asunto: input.asunto,
    cuerpo: input.cuerpo,
  })
  if (error) throw new Error(`sugerencias.crear: ${error.message}`)
}

export async function actualizarEstadoSugerencia(id: string, estado: SugerenciaEstado): Promise<void> {
  const { error } = await supabase.from('sugerencias').update({ estado }).eq('id', id)
  if (error) throw new Error(`sugerencias.actualizarEstado: ${error.message}`)
}
