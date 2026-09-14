// Feriados (calendario de OTTs, ATT) — catálogo abierto fecha+nombre,
// editable desde la propia vista de Calendario. Ver 0070_feriados.sql.

import { supabase } from './supabaseClient'

export interface Feriado {
  fecha: string // "YYYY-MM-DD"
  nombre: string
}

export async function listFeriados(): Promise<Feriado[]> {
  const { data, error } = await supabase.from('feriados').select('fecha, nombre').order('fecha')
  if (error) throw new Error(`feriados.list: ${error.message}`)
  return data as Feriado[]
}

export async function crearFeriado(fecha: string, nombre: string): Promise<Feriado> {
  const { data, error } = await supabase.from('feriados')
    .upsert({ fecha, nombre: nombre.trim() })
    .select('fecha, nombre')
    .single()
  if (error) throw new Error(`feriados.crear: ${error.message}`)
  return data as Feriado
}

export async function eliminarFeriado(fecha: string): Promise<void> {
  const { error } = await supabase.from('feriados').delete().eq('fecha', fecha)
  if (error) throw new Error(`feriados.eliminar: ${error.message}`)
}
