// Capa de datos del Panel de KPIs — wrappers tipados de las RPC de
// agregación (kpi_proyectos / kpi_materiales, ver
// supabase/migrations/0023_kpi_rpcs.sql). Toda la agregación vive en la BD;
// acá solo se traduce input/output entre camelCase y snake_case.

import { supabase } from '../supabaseClient'

export interface KpiProyectosResumen {
  abiertas: number
  cerradas: number
  pendientes: number
}

export interface KpiMaterialFila {
  materialId: string
  sku: string
  descripcion: string
  esConsumible: boolean
  solicitado: number
  entregado: number
  instalado: number
  devuelto: number
  rebajado: number
  merma: number
  transito: number
}

interface KpiProyectosRpcRow {
  abiertas: number
  cerradas: number
  pendientes: number
}

export async function getKpiProyectos(input: {
  area: 'ATT' | 'OyM'
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
}): Promise<KpiProyectosResumen> {
  const { data, error } = await supabase.rpc('kpi_proyectos', {
    p_area: input.area,
    p_subarea: input.subarea ?? null,
    p_desde: input.desde,
    p_hasta: input.hasta,
  })
  if (error) throw new Error(`kpi_proyectos: ${error.message}`)
  const row = (data as KpiProyectosRpcRow[] | null)?.[0]
  return { abiertas: Number(row?.abiertas ?? 0), cerradas: Number(row?.cerradas ?? 0), pendientes: Number(row?.pendientes ?? 0) }
}

interface KpiMaterialRpcRow {
  material_id: string
  sku: string
  descripcion: string
  es_consumible: boolean
  solicitado: number
  entregado: number
  instalado: number
  devuelto: number
  rebajado: number
  merma: number
  transito: number
}

export async function getKpiMateriales(input: {
  /** null = todas las áreas combinadas (vista "solo inventario"). */
  area: 'ATT' | 'OyM' | null
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
  ubicacionId?: string | null
  tecnicoIds?: string[] | null
}): Promise<KpiMaterialFila[]> {
  const { data, error } = await supabase.rpc('kpi_materiales', {
    p_area: input.area ?? null,
    p_subarea: input.subarea ?? null,
    p_desde: input.desde,
    p_hasta: input.hasta,
    p_ubicacion_id: input.ubicacionId ?? null,
    p_tecnico_ids: input.tecnicoIds && input.tecnicoIds.length > 0 ? input.tecnicoIds : null,
  })
  if (error) throw new Error(`kpi_materiales: ${error.message}`)
  return (data as KpiMaterialRpcRow[] | null ?? []).map((r) => ({
    materialId: r.material_id,
    sku: r.sku,
    descripcion: r.descripcion,
    esConsumible: r.es_consumible,
    solicitado: Number(r.solicitado),
    entregado: Number(r.entregado),
    instalado: Number(r.instalado),
    devuelto: Number(r.devuelto),
    rebajado: Number(r.rebajado),
    merma: Number(r.merma),
    transito: Number(r.transito),
  }))
}
