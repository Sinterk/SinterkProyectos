// Capa de datos del catálogo LPU y sus mapeos hacia materiales/tendido —
// ver src/lib/lpu/types.ts y docs/CONTINUAR-BACKEND.md punto 19.

import { supabase } from '../supabaseClient'
import type { LpuCodigo, LpuMaterialMap, LpuMaterialMapInput, LpuTendidoMap, LpuTendidoMapInput } from './types'

interface LpuCodigoRow {
  id: string
  codigo_att: string
  partida: string | null
  descripcion: string
  unidad: string | null
  tipo: string | null
  estado: string | null
}

function lpuCodigoFromRow(r: LpuCodigoRow): LpuCodigo {
  return {
    id: r.id, codigoAtt: r.codigo_att, partida: r.partida,
    descripcion: r.descripcion, unidad: r.unidad, tipo: r.tipo, estado: r.estado,
  }
}

/** Todo el catálogo LPU (~305 códigos) — filtrado/buscado en el cliente. */
export async function listLpuCodigos(): Promise<LpuCodigo[]> {
  const { data, error } = await supabase.from('lpu_codigos').select('*').order('codigo_att')
  if (error) throw new Error(`lpu_codigos.list: ${error.message}`)
  return (data as LpuCodigoRow[]).map(lpuCodigoFromRow)
}

// ---------------------------------------------------------------------------
// lpu_material_map
// ---------------------------------------------------------------------------

interface LpuMaterialMapRow {
  id: string
  material_id: string
  lpu_codigo_id: string
  factor_cantidad: number
  activo: boolean
  lpu_codigos: LpuCodigoRow | null
}

function materialMapFromRow(r: LpuMaterialMapRow): LpuMaterialMap {
  return {
    id: r.id, materialId: r.material_id, lpuCodigoId: r.lpu_codigo_id,
    factorCantidad: Number(r.factor_cantidad), activo: r.activo,
    lpuCodigo: r.lpu_codigos ? lpuCodigoFromRow(r.lpu_codigos) : null,
  }
}

/** Mapeos de un material específico (para el editor por material en admin). */
export async function listLpuMaterialMapPorMaterial(materialId: string): Promise<LpuMaterialMap[]> {
  const { data, error } = await supabase.from('lpu_material_map')
    .select('*, lpu_codigos(*)').eq('material_id', materialId).order('created_at')
  if (error) throw new Error(`lpu_material_map.listPorMaterial: ${error.message}`)
  return (data as LpuMaterialMapRow[]).map(materialMapFromRow)
}

export async function crearLpuMaterialMap(input: LpuMaterialMapInput): Promise<void> {
  const { error } = await supabase.from('lpu_material_map').insert({
    material_id: input.materialId, lpu_codigo_id: input.lpuCodigoId, factor_cantidad: input.factorCantidad,
  })
  if (error) throw new Error(`lpu_material_map.crear: ${error.message}`)
}

export async function actualizarLpuMaterialMap(id: string, cambios: { factorCantidad?: number; activo?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (cambios.factorCantidad !== undefined) patch.factor_cantidad = cambios.factorCantidad
  if (cambios.activo !== undefined) patch.activo = cambios.activo
  const { error } = await supabase.from('lpu_material_map').update(patch).eq('id', id)
  if (error) throw new Error(`lpu_material_map.actualizar: ${error.message}`)
}

export async function borrarLpuMaterialMap(id: string): Promise<void> {
  const { error } = await supabase.from('lpu_material_map').delete().eq('id', id)
  if (error) throw new Error(`lpu_material_map.borrar: ${error.message}`)
}

// ---------------------------------------------------------------------------
// lpu_tendido_map
// ---------------------------------------------------------------------------

interface LpuTendidoMapRow {
  id: string
  tipo_tendido: string
  capacidad_min: number | null
  capacidad_max: number | null
  lpu_codigo_id: string
  activo: boolean
  lpu_codigos: LpuCodigoRow | null
}

function tendidoMapFromRow(r: LpuTendidoMapRow): LpuTendidoMap {
  return {
    id: r.id, tipoTendido: r.tipo_tendido,
    capacidadMin: r.capacidad_min === null ? null : Number(r.capacidad_min),
    capacidadMax: r.capacidad_max === null ? null : Number(r.capacidad_max),
    lpuCodigoId: r.lpu_codigo_id, activo: r.activo,
    lpuCodigo: r.lpu_codigos ? lpuCodigoFromRow(r.lpu_codigos) : null,
  }
}

export async function listLpuTendidoMap(): Promise<LpuTendidoMap[]> {
  const { data, error } = await supabase.from('lpu_tendido_map')
    .select('*, lpu_codigos(*)').order('tipo_tendido')
  if (error) throw new Error(`lpu_tendido_map.list: ${error.message}`)
  return (data as LpuTendidoMapRow[]).map(tendidoMapFromRow)
}

export async function crearLpuTendidoMap(input: LpuTendidoMapInput): Promise<void> {
  const { error } = await supabase.from('lpu_tendido_map').insert({
    tipo_tendido: input.tipoTendido, capacidad_min: input.capacidadMin, capacidad_max: input.capacidadMax,
    lpu_codigo_id: input.lpuCodigoId,
  })
  if (error) throw new Error(`lpu_tendido_map.crear: ${error.message}`)
}

export async function actualizarLpuTendidoMap(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from('lpu_tendido_map').update({ activo }).eq('id', id)
  if (error) throw new Error(`lpu_tendido_map.actualizar: ${error.message}`)
}

export async function borrarLpuTendidoMap(id: string): Promise<void> {
  const { error } = await supabase.from('lpu_tendido_map').delete().eq('id', id)
  if (error) throw new Error(`lpu_tendido_map.borrar: ${error.message}`)
}
