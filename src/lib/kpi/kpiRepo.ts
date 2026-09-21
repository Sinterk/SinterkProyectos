// Capa de datos del Panel de KPIs — wrappers tipados de las RPC de
// agregación (kpi_proyectos_detalle / kpi_materiales, ver
// supabase/migrations/0027_kpi_v2.sql). Toda la agregación vive en la BD;
// acá solo se traduce input/output entre camelCase y snake_case.

import { supabase } from '../supabaseClient'

export type KpiProyectoEstado = 'abierto' | 'cerrado' | 'pendiente'

export interface KpiProyectoFila {
  projectId: string
  ott: string
  estado: KpiProyectoEstado
  fechaInicio: string
}

interface KpiProyectoRpcRow {
  project_id: string
  ott: string
  estado: KpiProyectoEstado
  fecha_inicio: string
}

export async function getKpiProyectosDetalle(input: {
  area: 'ATT' | 'OyM'
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
}): Promise<KpiProyectoFila[]> {
  const { data, error } = await supabase.rpc('kpi_proyectos_detalle', {
    p_area: input.area,
    p_subarea: input.subarea ?? null,
    p_desde: input.desde,
    p_hasta: input.hasta,
  })
  if (error) throw new Error(`kpi_proyectos_detalle: ${error.message}`)
  return (data as KpiProyectoRpcRow[] | null ?? []).map((r) => ({
    projectId: r.project_id, ott: r.ott, estado: r.estado, fechaInicio: r.fecha_inicio,
  }))
}

export interface KpiMaterialFila {
  materialId: string
  sku: string
  descripcion: string
  solicitado: number
  entregado: number
  instalado: number
  devuelto: number
  rebajado: number
  merma: number
  transito: number
  /** Bodegas con movimientos en el periodo (todas, siempre). null = ninguna. */
  origenBodega: string | null
  /** Técnicos con movimientos en el periodo. null = ninguno. */
  origenTecnico: string | null
  /** Saldo actual (no histórico) en `stockUbicacionIds` — null si no se pidió. */
  fisico: number | null
  digital: number | null
  /** Bodega(s) de `stockUbicacionIds` con Físico/Digital ≠ 0 para este material — a qué bodega comparar el consumo. null si no se pidió stock, o si no tiene stock ahí. */
  bodegaStock: string | null
}

interface KpiMaterialRpcRow {
  material_id: string
  sku: string
  descripcion: string
  solicitado: number
  entregado: number
  instalado: number
  devuelto: number
  rebajado: number
  merma: number
  transito: number
  origen_bodega: string | null
  origen_tecnico: string | null
  fisico: number | null
  digital: number | null
  bodega_stock: string | null
}

export interface KpiConciliacionFila {
  materialId: string
  sku: string
  descripcion: string
  fisicoBodegas: number
  fisicoTecnicos: number
  fisicoInstaladoAtt: number
  fisicoMerma: number
  fisicoTotal: number
  digitalSap: number
  /** digitalSap - fisicoTotal. Positivo = falta físico para cuadrar con SAP; negativo = colchón. */
  diferenciaSap: number
  fisicoStk: number
  digitalStk: number
  diferenciaStk: number
}

interface KpiConciliacionRpcRow {
  material_id: string
  sku: string
  descripcion: string
  fisico_bodegas: number
  fisico_tecnicos: number
  fisico_instalado_att: number
  fisico_merma: number
  fisico_total: number
  digital_sap: number
  diferencia_sap: number
  fisico_stk: number
  digital_stk: number
  diferencia_stk: number
}

/**
 * KPI de conciliación físico/digital por SKU — ver el comentario largo en
 * `supabase/migrations/0073_kpi_conciliacion_sap.sql` para la fórmula
 * completa y por qué SAP y STK se comparan por separado.
 */
export async function getKpiConciliacionSap(input: {
  bodegasSapIds: string[]
  bodegaStkId: string
}): Promise<KpiConciliacionFila[]> {
  const { data, error } = await supabase.rpc('kpi_conciliacion_sap', {
    p_bodegas_sap_ids: input.bodegasSapIds,
    p_bodega_stk_id: input.bodegaStkId,
  })
  if (error) throw new Error(`kpi_conciliacion_sap: ${error.message}`)
  return (data as KpiConciliacionRpcRow[] | null ?? []).map((r) => ({
    materialId: r.material_id,
    sku: r.sku,
    descripcion: r.descripcion,
    fisicoBodegas: Number(r.fisico_bodegas),
    fisicoTecnicos: Number(r.fisico_tecnicos),
    fisicoInstaladoAtt: Number(r.fisico_instalado_att),
    fisicoMerma: Number(r.fisico_merma),
    fisicoTotal: Number(r.fisico_total),
    digitalSap: Number(r.digital_sap),
    diferenciaSap: Number(r.diferencia_sap),
    fisicoStk: Number(r.fisico_stk),
    digitalStk: Number(r.digital_stk),
    diferenciaStk: Number(r.diferencia_stk),
  }))
}

export async function getKpiMateriales(input: {
  /** null = todas las áreas combinadas (vista "solo inventario"). */
  area: 'ATT' | 'OyM' | null
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
  /** Filtro de inclusión (modo bodega de Inventario, multi-selección). null/vacío = todas. */
  ubicacionIds?: string[] | null
  /** Se excluyen de la consulta (ej. Insumos, que tiene su propia tabla). */
  excluirUbicacionIds?: string[] | null
  tecnicoIds?: string[] | null
  /** Bodega(s) cuyo Físico/Digital se calcula — solo pedir cuando `hasta` es hoy (ver KpiScreen). */
  stockUbicacionIds?: string[] | null
}): Promise<KpiMaterialFila[]> {
  const { data, error } = await supabase.rpc('kpi_materiales', {
    p_area: input.area ?? null,
    p_subarea: input.subarea ?? null,
    p_desde: input.desde,
    p_hasta: input.hasta,
    p_ubicacion_ids: input.ubicacionIds && input.ubicacionIds.length > 0 ? input.ubicacionIds : null,
    p_excluir_ubicacion_ids: input.excluirUbicacionIds && input.excluirUbicacionIds.length > 0 ? input.excluirUbicacionIds : null,
    p_tecnico_ids: input.tecnicoIds && input.tecnicoIds.length > 0 ? input.tecnicoIds : null,
    p_stock_ubicacion_ids: input.stockUbicacionIds && input.stockUbicacionIds.length > 0 ? input.stockUbicacionIds : null,
  })
  if (error) throw new Error(`kpi_materiales: ${error.message}`)
  return (data as KpiMaterialRpcRow[] | null ?? []).map((r) => ({
    materialId: r.material_id,
    sku: r.sku,
    descripcion: r.descripcion,
    solicitado: Number(r.solicitado),
    entregado: Number(r.entregado),
    instalado: Number(r.instalado),
    devuelto: Number(r.devuelto),
    rebajado: Number(r.rebajado),
    merma: Number(r.merma),
    transito: Number(r.transito),
    origenBodega: r.origen_bodega,
    origenTecnico: r.origen_tecnico,
    fisico: r.fisico === null ? null : Number(r.fisico),
    digital: r.digital === null ? null : Number(r.digital),
    bodegaStock: r.bodega_stock,
  }))
}
