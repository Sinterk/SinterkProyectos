// Texto de "Corrección" que se autocompleta al elegir un tipo de hallazgo en
// Preventivos (PuntoCard.tsx) — editable desde Administración (pedido de
// Andrés, por si llega feedback y hay que ajustar el texto sin deploy). Ver
// supabase/migrations/0062_correcciones_hallazgo.sql.
//
// Desde 0068_catalogo_hallazgos.sql esta misma tabla es también el catálogo
// de tipos de hallazgo (antes un array fijo en hallazgos.ts): `orden` es el
// número que se ve en el selector, `activo` permite sacar un hallazgo del
// selector sin borrarlo (los puntos ya registrados con ese texto lo siguen
// necesitando). Ver el comentario de esa migración sobre por qué esto NO
// alcanza al informe ACTA de Entel (formato fijo, ajeno).

import { supabase } from './supabaseClient'

export interface CorreccionHallazgo {
  hallazgo: string
  correccion: string
  orden: number
  activo: boolean
}

/** Todas las filas — incluye inactivas, para que Administración pueda reactivarlas. Ordenadas por `orden`. */
export async function listCorreccionesHallazgo(): Promise<CorreccionHallazgo[]> {
  const { data, error } = await supabase.from('correcciones_hallazgo')
    .select('hallazgo, correccion, orden, activo')
    .order('orden', { ascending: true })
  if (error) throw new Error(`correccionesHallazgo.list: ${error.message}`)
  return data as CorreccionHallazgo[]
}

/** Actualiza el texto de Corrección de un hallazgo ya existente en el catálogo. */
export async function guardarCorreccionHallazgo(hallazgo: string, correccion: string): Promise<void> {
  const { error } = await supabase.from('correcciones_hallazgo')
    .update({ correccion: correccion.trim() })
    .eq('hallazgo', hallazgo)
  if (error) throw new Error(`correccionesHallazgo.guardar: ${error.message}`)
}

/**
 * Agrega un tipo de hallazgo nuevo al catálogo (Administración) — sin tocar
 * código. Queda al final (`orden` = max + 1) y visible de inmediato en el
 * selector de Preventivos. NO aparece en el resumen del Acta Entel (ver
 * comentario arriba) hasta que alguien también actualice esa plantilla.
 */
export async function crearHallazgo(nombre: string): Promise<void> {
  const filas = await listCorreccionesHallazgo()
  if (filas.some((f) => f.hallazgo.trim().toLowerCase() === nombre.trim().toLowerCase())) {
    throw new Error('Ya existe un hallazgo con ese nombre')
  }
  const siguienteOrden = filas.reduce((max, f) => Math.max(max, f.orden), 0) + 1
  const { error } = await supabase.from('correcciones_hallazgo')
    .insert({ hallazgo: nombre.trim(), correccion: '', orden: siguienteOrden, activo: true })
  if (error) throw new Error(`correccionesHallazgo.crear: ${error.message}`)
}

/** Saca (o repone) un hallazgo del selector de Preventivos sin borrar su fila — los puntos que ya lo tengan asignado lo siguen mostrando. */
export async function setHallazgoActivo(hallazgo: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('correcciones_hallazgo').update({ activo }).eq('hallazgo', hallazgo)
  if (error) throw new Error(`correccionesHallazgo.setActivo: ${error.message}`)
}
