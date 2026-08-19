// Texto de "Corrección" que se autocompleta al elegir un tipo de hallazgo en
// Preventivos (PuntoCard.tsx) — editable desde Administración (pedido de
// Andrés, por si llega feedback y hay que ajustar el texto sin deploy). Ver
// supabase/migrations/0062_correcciones_hallazgo.sql.

import { supabase } from './supabaseClient'

export interface CorreccionHallazgo {
  hallazgo: string
  correccion: string
}

/** Todas las filas sembradas — puede haber hallazgos de `HALLAZGOS` sin fila acá (quedan como "sin definir" en el editor). */
export async function listCorreccionesHallazgo(): Promise<CorreccionHallazgo[]> {
  const { data, error } = await supabase.from('correcciones_hallazgo').select('hallazgo, correccion')
  if (error) throw new Error(`correccionesHallazgo.list: ${error.message}`)
  return data as CorreccionHallazgo[]
}

/**
 * Crea o actualiza el texto de un hallazgo. `upsert` porque el hallazgo
 * puede no tener fila todavía (los 2 que llegaron sin texto definido, o uno
 * agregado a `HALLAZGOS` después de esta migración).
 */
export async function guardarCorreccionHallazgo(hallazgo: string, correccion: string): Promise<void> {
  const { error } = await supabase.from('correcciones_hallazgo').upsert({ hallazgo, correccion: correccion.trim() })
  if (error) throw new Error(`correccionesHallazgo.guardar: ${error.message}`)
}
