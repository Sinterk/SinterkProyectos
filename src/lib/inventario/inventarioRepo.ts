// Capa de datos compartida de Inventario — usada por la ventana Inventario y
// por las pestañas "Logística" de ATT/Preventivos. La lógica de negocio de
// "registrar un movimiento" vive en la base de datos (funciones
// registrar_movimiento / reasignar_transito_a_preventivo, ver
// supabase/migrations/0005_registrar_movimiento.sql) por atomicidad y
// permisos; este archivo solo hace lecturas + wrappers tipados de esas RPC.

import { supabase } from '../supabaseClient'
import type {
  Material, MaterialTipo, Proveedor, Ubicacion, UbicacionTipo, StockRow, Movimiento,
  RegistrarMovimientoInput, ReasignarTransitoInput,
  ResumenMaterialProyecto, TecnicoLedgerRow,
  Conteo, ConteoLinea, EventoInventario, ResolucionTipo, ConsumoArea, ResolverEventoInput, Observacion,
} from './types'
import type { FilaImportSap } from './importarSap'

// Nota sobre embeds de PostgREST: `stock`/`movimientos`/`proyecto_materiales`
// referencian a `materiales`/`ubicaciones`/`profiles`/`projects` con una FK
// "hacia adelante" (la tabla consultada TIENE la columna *_id). Ese tipo de
// embed vuelve como objeto simple (o null), no como array — confirmado
// empíricamente contra la BD real. Solo es array cuando el embed va "hacia
// atrás" (ej. `projects.informes(...)`, donde `informes` tiene el FK).

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------

interface MaterialRow {
  id: string
  sku: string
  descripcion: string
  apodo: string | null
  unidad: string | null
  categoria: string | null
  controla_lote_fisico: boolean
  activo: boolean
  stock_minimo: number | null
  comentario: string | null
  tipo_tendido: string | null
  capacidad: number | null
  tipo_id: string | null
  material_tipos: { id: string; nombre: string } | null
  // Embed a través de la tabla de unión material_proveedores (N a N) —
  // vuelve como un array de wrappers, uno por fila de la unión.
  material_proveedores: { proveedores: { id: string; nombre: string } | null }[]
}

function materialFromRow(m: MaterialRow): Material {
  return {
    id: m.id, sku: m.sku, descripcion: m.descripcion, apodo: m.apodo,
    unidad: m.unidad, categoria: m.categoria,
    controlaLoteFisico: m.controla_lote_fisico, activo: m.activo,
    stockMinimo: m.stock_minimo === null ? null : Number(m.stock_minimo),
    comentario: m.comentario,
    tipoTendido: m.tipo_tendido,
    capacidad: m.capacidad === null ? null : Number(m.capacidad),
    tipoId: m.tipo_id,
    tipo: m.material_tipos,
    proveedores: (m.material_proveedores ?? []).map((mp) => mp.proveedores).filter((p): p is Proveedor => p !== null),
  }
}

/** Todos los materiales activos. El filtrado por texto (SKU/descripción/apodo) se hace en el cliente. */
export async function listMateriales(): Promise<Material[]> {
  const { data, error } = await supabase.from('materiales')
    .select('*, material_tipos(id, nombre), material_proveedores(proveedores(id, nombre))')
    .eq('activo', true).order('sku')
  if (error) throw new Error(`materiales.list: ${error.message}`)
  return (data as MaterialRow[]).map(materialFromRow)
}

/** Umbral de alerta ("hay que renovar") — null para quitarlo. */
export async function updateMaterialStockMinimo(materialId: string, stockMinimo: number | null): Promise<void> {
  const { error } = await supabase.from('materiales').update({ stock_minimo: stockMinimo }).eq('id', materialId)
  if (error) throw new Error(`materiales.updateStockMinimo: ${error.message}`)
}

/** Observación libre del material — cadena vacía o null para quitarla. */
export async function updateMaterialComentario(materialId: string, comentario: string | null): Promise<void> {
  const valor = comentario?.trim() || null
  const { error } = await supabase.from('materiales').update({ comentario: valor }).eq('id', materialId)
  if (error) throw new Error(`materiales.updateComentario: ${error.message}`)
}

/** Tipo de tendido + capacidad — solo tiene sentido para SKUs de cable, usado por el Estado de Pago. */
export async function updateMaterialTendido(materialId: string, valores: { tipoTendido: string | null; capacidad: number | null }): Promise<void> {
  const { error } = await supabase.from('materiales')
    .update({ tipo_tendido: valores.tipoTendido, capacidad: valores.capacidad }).eq('id', materialId)
  if (error) throw new Error(`materiales.updateTendido: ${error.message}`)
}

/** Nombre alternativo ("apodo") — el nombre con el que se conoce el material en terreno (ej. "CMIC" = ODF 12 fibras). Cadena vacía o null para quitarlo. */
export async function updateMaterialApodo(materialId: string, apodo: string | null): Promise<void> {
  const valor = apodo?.trim() || null
  const { error } = await supabase.from('materiales').update({ apodo: valor }).eq('id', materialId)
  if (error) throw new Error(`materiales.updateApodo: ${error.message}`)
}

/** Clasificación del Catálogo de materiales — null = "vacío". */
export async function updateMaterialTipo(materialId: string, tipoId: string | null): Promise<void> {
  const { error } = await supabase.from('materiales').update({ tipo_id: tipoId }).eq('id', materialId)
  if (error) throw new Error(`materiales.updateTipo: ${error.message}`)
}

/**
 * Reemplaza TODOS los proveedores asignados al material por el set dado
 * (borra + inserta) — se llama una sola vez al cerrar el selector en la UI,
 * no por cada clic (ver ProveedoresSelect en Home.tsx: un `UPDATE` por
 * checkbox marcado dejaba dos escrituras en carrera sobre la misma fila).
 */
export async function updateMaterialProveedores(materialId: string, proveedorIds: string[]): Promise<void> {
  const { error: errDel } = await supabase.from('material_proveedores').delete().eq('material_id', materialId)
  if (errDel) throw new Error(`material_proveedores.reemplazar (borrar previos): ${errDel.message}`)
  if (proveedorIds.length > 0) {
    const { error: errIns } = await supabase.from('material_proveedores')
      .insert(proveedorIds.map((proveedorId) => ({ material_id: materialId, proveedor_id: proveedorId })))
    if (errIns) throw new Error(`material_proveedores.reemplazar (insertar): ${errIns.message}`)
  }
}

// ---------------------------------------------------------------------------
// Tipos de material (Catálogo) — lista abierta, ver material_tipos
// ---------------------------------------------------------------------------

export async function listMaterialTipos(): Promise<MaterialTipo[]> {
  const { data, error } = await supabase.from('material_tipos').select('id, nombre').order('nombre')
  if (error) throw new Error(`material_tipos.list: ${error.message}`)
  return data as MaterialTipo[]
}

export async function crearMaterialTipo(nombre: string): Promise<MaterialTipo> {
  const { data, error } = await supabase.from('material_tipos').insert({ nombre: nombre.trim() }).select('id, nombre').single()
  if (error) throw new Error(`material_tipos.crear: ${error.message}`)
  return data as MaterialTipo
}

// ---------------------------------------------------------------------------
// Proveedores (Catálogo) — lista abierta, N a N vía material_proveedores
// ---------------------------------------------------------------------------

export async function listProveedores(): Promise<Proveedor[]> {
  const { data, error } = await supabase.from('proveedores').select('id, nombre').order('nombre')
  if (error) throw new Error(`proveedores.list: ${error.message}`)
  return data as Proveedor[]
}

export async function crearProveedor(nombre: string): Promise<Proveedor> {
  const { data, error } = await supabase.from('proveedores').insert({ nombre: nombre.trim() }).select('id, nombre').single()
  if (error) throw new Error(`proveedores.crear: ${error.message}`)
  return data as Proveedor
}

// ---------------------------------------------------------------------------
// Ubicaciones
// ---------------------------------------------------------------------------

interface UbicacionRow {
  id: string
  nombre: string
  tipo: UbicacionTipo
  owner_user_id: string | null
  activo: boolean
}

function ubicacionFromRow(u: UbicacionRow): Ubicacion {
  return { id: u.id, nombre: u.nombre, tipo: u.tipo, ownerUserId: u.owner_user_id, activo: u.activo }
}

export async function listUbicaciones(opts?: { tipo?: UbicacionTipo }): Promise<Ubicacion[]> {
  let query = supabase.from('ubicaciones').select('*').eq('activo', true).order('nombre')
  if (opts?.tipo) query = query.eq('tipo', opts.tipo)
  const { data, error } = await query
  if (error) throw new Error(`ubicaciones.list: ${error.message}`)
  return (data as UbicacionRow[]).map(ubicacionFromRow)
}

export async function crearUbicacion(nombre: string): Promise<Ubicacion> {
  const { data, error } = await supabase
    .from('ubicaciones').insert({ nombre, tipo: 'bodega' }).select('*').single()
  if (error) throw new Error(`ubicaciones.crear: ${error.message}`)
  return ubicacionFromRow(data as UbicacionRow)
}

// ---------------------------------------------------------------------------
// Stock (pestaña Bodega)
// ---------------------------------------------------------------------------

interface StockJoinRow {
  ubicacion_id: string
  material_id: string
  lote: string
  cantidad_fisico: number
  cantidad_digital: number
  ubicaciones: { nombre: string } | null
  materiales: { sku: string; descripcion: string; stock_minimo: number | null; comentario: string | null } | null
}

/** Filtro por ubicación/material/lote exactos; `search` filtra en el cliente sobre nombre/sku/descripción. */
export async function getStock(opts?: {
  ubicacionId?: string; materialId?: string; lote?: string; search?: string
}): Promise<StockRow[]> {
  let query = supabase
    .from('stock')
    .select('ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital, ubicaciones(nombre), materiales(sku, descripcion, stock_minimo, comentario)')
    .order('lote')
  if (opts?.ubicacionId) query = query.eq('ubicacion_id', opts.ubicacionId)
  if (opts?.materialId) query = query.eq('material_id', opts.materialId)
  if (opts?.lote) query = query.eq('lote', opts.lote)

  const { data, error } = await query
  if (error) throw new Error(`stock.list: ${error.message}`)

  const rows: StockRow[] = (data as unknown as StockJoinRow[]).map((r) => ({
    ubicacionId: r.ubicacion_id,
    ubicacionNombre: r.ubicaciones?.nombre ?? '',
    materialId: r.material_id,
    materialSku: r.materiales?.sku ?? '',
    materialDescripcion: r.materiales?.descripcion ?? '',
    lote: r.lote,
    cantidadFisico: Number(r.cantidad_fisico),
    cantidadDigital: Number(r.cantidad_digital),
    stockMinimo: r.materiales?.stock_minimo === null || r.materiales?.stock_minimo === undefined ? null : Number(r.materiales.stock_minimo),
    comentario: r.materiales?.comentario ?? null,
  }))

  const q = opts?.search?.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) =>
    r.ubicacionNombre.toLowerCase().includes(q)
    || r.materialSku.toLowerCase().includes(q)
    || r.materialDescripcion.toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// Movimientos (pestaña Movimientos)
// ---------------------------------------------------------------------------

interface MovimientoJoinRow {
  id: string
  material_id: string
  ubicacion_id: string
  ubicacion_destino_id: string | null
  lote: string
  naturaleza: 'fisico' | 'digital'
  tipo: string
  cantidad: number
  project_id: string | null
  area: 'ATT' | 'OyM' | null
  punto_id: string | null
  usuario_id: string | null
  fecha: string
  nota: string | null
  proveedor: string | null
  documento: string | null
  created_at: string
  materiales: { sku: string; descripcion: string } | null
  origen: { nombre: string } | null
  destino: { nombre: string } | null
  profiles: { nombre: string | null; email: string | null } | null
  projects: { ott: string } | null
}

function movimientoFromJoinRow(r: MovimientoJoinRow): Movimiento {
  return {
    id: r.id,
    materialId: r.material_id,
    materialSku: r.materiales?.sku ?? '',
    materialDescripcion: r.materiales?.descripcion ?? '',
    ubicacionId: r.ubicacion_id,
    ubicacionNombre: r.origen?.nombre ?? '',
    ubicacionDestinoId: r.ubicacion_destino_id,
    ubicacionDestinoNombre: r.destino?.nombre ?? null,
    lote: r.lote,
    naturaleza: r.naturaleza,
    tipo: r.tipo,
    cantidad: Number(r.cantidad),
    projectId: r.project_id,
    projectOtt: r.projects?.ott ?? null,
    area: r.area,
    puntoId: r.punto_id,
    usuarioId: r.usuario_id,
    usuarioNombre: r.profiles?.nombre?.trim() || r.profiles?.email || null,
    fecha: r.fecha,
    nota: r.nota,
    proveedor: r.proveedor,
    documento: r.documento,
    createdAt: r.created_at,
  }
}

export interface ListMovimientosFilters {
  materialId?: string
  ubicacionId?: string
  projectId?: string
  usuarioId?: string
  tipo?: string
  desde?: string
  hasta?: string
  limit?: number
}

export async function listMovimientos(filters?: ListMovimientosFilters): Promise<Movimiento[]> {
  let query = supabase
    .from('movimientos')
    .select('*, materiales(sku,descripcion), origen:ubicaciones!ubicacion_id(nombre), destino:ubicaciones!ubicacion_destino_id(nombre), profiles(nombre,email), projects(ott)')
    .order('fecha', { ascending: false })
    .limit(filters?.limit ?? 200)

  if (filters?.materialId) query = query.eq('material_id', filters.materialId)
  if (filters?.ubicacionId) query = query.eq('ubicacion_id', filters.ubicacionId)
  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  if (filters?.usuarioId) query = query.eq('usuario_id', filters.usuarioId)
  if (filters?.tipo) query = query.eq('tipo', filters.tipo)
  if (filters?.desde) query = query.gte('fecha', filters.desde)
  if (filters?.hasta) query = query.lte('fecha', filters.hasta)

  const { data, error } = await query
  if (error) throw new Error(`movimientos.list: ${error.message}`)
  return (data as unknown as MovimientoJoinRow[]).map(movimientoFromJoinRow)
}

// ---------------------------------------------------------------------------
// Registrar movimiento / reasignar tránsito (RPC — lógica en la BD)
// ---------------------------------------------------------------------------

export interface MovimientoCreado {
  id: string
  materialId: string
  ubicacionId: string
  ubicacionDestinoId: string | null
  lote: string
  naturaleza: 'fisico' | 'digital'
  tipo: string
  cantidad: number
  projectId: string | null
  area: 'ATT' | 'OyM' | null
  puntoId: string | null
  usuarioId: string | null
  fecha: string
  /** true solo para 'instalado' forzado en negativo (sin stock en el proyecto ni el equipo) — ver 0025_prioridad_instalado.sql. */
  requiereRevision: boolean
}

interface MovimientoRpcRow {
  id: string; material_id: string; ubicacion_id: string; ubicacion_destino_id: string | null; lote: string
  naturaleza: 'fisico' | 'digital'; tipo: string; cantidad: number
  project_id: string | null; area: 'ATT' | 'OyM' | null
  punto_id: string | null; usuario_id: string | null; fecha: string
  requiere_revision: boolean
}

/** Sube el movimiento vía la función de BD (atómica: stock + movimientos + proyecto_materiales). */
export async function registrarMovimiento(input: RegistrarMovimientoInput): Promise<MovimientoCreado> {
  const { data, error } = await supabase.rpc('registrar_movimiento', {
    p_tipo_ui: input.tipoUI,
    p_material_id: input.materialId,
    p_cantidad: input.cantidad,
    p_lote: input.lote ?? null,
    p_fecha: input.fecha ?? null,
    p_nota: input.nota ?? null,
    p_ubicacion_bodega_id: input.ubicacionBodegaId ?? null,
    p_proveedor: input.proveedor ?? null,
    p_documento: input.documento ?? null,
    p_project_id: input.projectId ?? null,
    p_punto_id: input.puntoId ?? null,
    p_tecnico_user_id: input.tecnicoUserId ?? null,
    p_area: input.area ?? null,
    p_ubicacion_bodega_destino_id: input.ubicacionBodegaDestinoId ?? null,
  })
  if (error) throw new Error(`registrar_movimiento: ${error.message}`)
  const row = data as MovimientoRpcRow
  return {
    id: row.id, materialId: row.material_id, ubicacionId: row.ubicacion_id, ubicacionDestinoId: row.ubicacion_destino_id, lote: row.lote,
    naturaleza: row.naturaleza, tipo: row.tipo, cantidad: Number(row.cantidad),
    projectId: row.project_id, area: row.area, puntoId: row.punto_id, usuarioId: row.usuario_id, fecha: row.fecha,
    requiereRevision: row.requiere_revision,
  }
}

export type CampoCorregible = 'cant_entregada' | 'cant_instalada' | 'cant_devuelta' | 'cant_rebajada' | 'cant_merma'

/**
 * Corrección directa de un error de tipeo (Entregado/Instalado/Devuelto/
 * Rebajado): sobreescribe el número sin generar movimiento ni tocar stock
 * — ver supabase/migrations/0014_corregir_proyecto_material.sql. No usar
 * para registrar algo que de verdad pasó (para eso está registrarMovimiento).
 */
export async function corregirProyectoMaterial(input: {
  projectId: string; materialId: string; lote: string; puntoId: string | null
  campo: CampoCorregible; valor: number
}): Promise<void> {
  const { error } = await supabase.rpc('corregir_proyecto_material', {
    p_project_id: input.projectId, p_material_id: input.materialId, p_lote: input.lote,
    p_punto_id: input.puntoId, p_campo: input.campo, p_valor: input.valor,
  })
  if (error) throw new Error(`corregir_proyecto_material: ${error.message}`)
}

/** Cierra el "tránsito" de un proyecto pasando esa cantidad al técnico como preventivo (no toca stock, ver migración 0006). */
export async function reasignarTransitoAPreventivo(input: ReasignarTransitoInput): Promise<void> {
  const { error } = await supabase.rpc('reasignar_transito_a_preventivo', {
    p_project_id: input.projectId,
    p_material_id: input.materialId,
    p_lote: input.lote ?? null,
    p_punto_id: input.puntoId ?? null,
    p_tecnico_user_id: input.tecnicoUserId,
    p_cantidad: input.cantidad,
  })
  if (error) throw new Error(`reasignar_transito_a_preventivo: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Resumen por proyecto (pestaña Logística)
// ---------------------------------------------------------------------------

interface ProyectoMaterialJoinRow {
  material_id: string
  lote: string
  punto_id: string | null
  cant_entregada: number
  cant_instalada: number
  cant_devuelta: number
  cant_rezagada: number
  cant_rebajada: number
  cant_merma: number
  materiales: { sku: string; descripcion: string } | null
}

interface SolicitudJoinRow {
  material_id: string
  lote: string
  punto_id: string | null
  cantidad: number
  materiales: { sku: string; descripcion: string } | null
}

/**
 * Resumen de materiales de un proyecto: cuánto se solicitó/entregó/instaló/
 * devolvió/rebajó, más el tránsito calculado. `cant_solicitada` no vive en
 * `proyecto_materiales` (una solicitud no toca esa tabla) — se suma aparte
 * desde `movimientos` tipo='solicitud'.
 */
export async function getResumenProyecto(projectId: string): Promise<ResumenMaterialProyecto[]> {
  const [pmRes, solRes] = await Promise.all([
    supabase
      .from('proyecto_materiales')
      .select('material_id, lote, punto_id, cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada, cant_merma, materiales(sku, descripcion)')
      .eq('project_id', projectId),
    supabase
      .from('movimientos')
      .select('material_id, lote, punto_id, cantidad, materiales(sku, descripcion)')
      .eq('project_id', projectId)
      .eq('tipo', 'solicitud'),
  ])
  if (pmRes.error) throw new Error(`proyecto_materiales.resumen: ${pmRes.error.message}`)
  if (solRes.error) throw new Error(`movimientos.solicitudes: ${solRes.error.message}`)

  const key = (materialId: string, lote: string, puntoId: string | null) => `${materialId}|${lote}|${puntoId ?? ''}`
  const map = new Map<string, ResumenMaterialProyecto>()

  function ensure(materialId: string, lote: string, puntoId: string | null, mat: { sku: string; descripcion: string } | null) {
    const k = key(materialId, lote, puntoId)
    let row = map.get(k)
    if (!row) {
      row = {
        materialId, materialSku: mat?.sku ?? '', materialDescripcion: mat?.descripcion ?? '',
        lote, puntoId,
        cantSolicitada: 0, cantEntregada: 0, cantInstalada: 0, cantDevuelta: 0, cantRezagada: 0, cantRebajada: 0,
        cantMerma: 0, cantTransito: 0,
      }
      map.set(k, row)
    }
    return row
  }

  for (const r of (pmRes.data as unknown as ProyectoMaterialJoinRow[])) {
    const row = ensure(r.material_id, r.lote, r.punto_id, r.materiales)
    row.cantEntregada = Number(r.cant_entregada)
    row.cantInstalada = Number(r.cant_instalada)
    row.cantDevuelta = Number(r.cant_devuelta)
    row.cantRezagada = Number(r.cant_rezagada)
    row.cantRebajada = Number(r.cant_rebajada)
    row.cantMerma = Number(r.cant_merma)
  }

  for (const r of (solRes.data as unknown as SolicitudJoinRow[])) {
    const row = ensure(r.material_id, r.lote, r.punto_id, r.materiales)
    row.cantSolicitada += Number(r.cantidad)
  }

  for (const row of map.values()) {
    row.cantTransito = row.cantEntregada - row.cantInstalada - row.cantDevuelta - row.cantRezagada - row.cantMerma
  }

  return [...map.values()].sort((a, b) => a.materialSku.localeCompare(b.materialSku))
}

// ---------------------------------------------------------------------------
// Ledger por técnico (pestaña Técnico)
// ---------------------------------------------------------------------------

interface MovimientoLedgerJoinRow {
  project_id: string | null
  material_id: string
  lote: string
  tipo: string
  cantidad: number
  materiales: { sku: string; descripcion: string } | null
  projects: { ott: string; area: string } | null
}

/**
 * Lo que un técnico tiene entregado/instalado/devuelto/rebajado, agrupado
 * por proyecto+material+lote, calculado desde el libro de `movimientos`
 * (no desde `proyecto_materiales`, que es un acumulado de TODOS los técnicos
 * del proyecto). Las filas con `projectId: null` son material reasignado
 * como preventivo (sin proyecto asociado).
 */
export async function getTecnicoLedger(userId: string): Promise<TecnicoLedgerRow[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('project_id, material_id, lote, tipo, cantidad, materiales(sku,descripcion), projects(ott,area)')
    .eq('usuario_id', userId)
    .in('tipo', ['salida', 'instalado', 'traslado', 'rebaja', 'merma'])
  if (error) throw new Error(`movimientos.tecnico: ${error.message}`)

  const key = (r: MovimientoLedgerJoinRow) => `${r.project_id ?? ''}|${r.material_id}|${r.lote}`
  const map = new Map<string, TecnicoLedgerRow>()

  for (const r of (data as unknown as MovimientoLedgerJoinRow[])) {
    const k = key(r)
    let row = map.get(k)
    if (!row) {
      row = {
        projectId: r.project_id, projectOtt: r.projects?.ott ?? null, projectArea: r.projects?.area ?? null,
        materialId: r.material_id, materialSku: r.materiales?.sku ?? '', materialDescripcion: r.materiales?.descripcion ?? '',
        lote: r.lote,
        cantEntregada: 0, cantInstalada: 0, cantDevuelta: 0, cantRebajada: 0, cantMerma: 0, cantTransito: 0,
      }
      map.set(k, row)
    }
    const cantidad = Number(r.cantidad)
    if (r.tipo === 'salida') row.cantEntregada += cantidad
    else if (r.tipo === 'instalado') row.cantInstalada += cantidad
    else if (r.tipo === 'traslado') row.cantDevuelta += cantidad
    else if (r.tipo === 'rebaja') row.cantRebajada += cantidad
    else if (r.tipo === 'merma') row.cantMerma += cantidad
  }

  for (const row of map.values()) {
    row.cantTransito = row.cantEntregada - row.cantInstalada - row.cantDevuelta - row.cantRebajada - row.cantMerma
  }

  return [...map.values()]
    .filter((r) => r.cantEntregada !== 0 || r.cantTransito !== 0)
    .sort((a, b) => (a.projectOtt ?? '').localeCompare(b.projectOtt ?? ''))
}

// ---------------------------------------------------------------------------
// Conteo (reconciliación manual de stock) — lógica de apertura/cierre en la
// BD (abrir_conteo/cerrar_conteo/etc., ver supabase/migrations/0009_conteo.sql)
// por la misma razón que registrar_movimiento: debe ser atómico.
// ---------------------------------------------------------------------------

interface ConteoJoinRow {
  id: string
  ubicacion_id: string
  naturaleza: 'fisico' | 'digital'
  fecha: string
  usuario_id: string | null
  estado: 'abierto' | 'cerrado'
  nota: string | null
  created_at: string
  ubicaciones: { nombre: string } | null
}

function conteoFromJoinRow(r: ConteoJoinRow): Conteo {
  return {
    id: r.id, ubicacionId: r.ubicacion_id, ubicacionNombre: r.ubicaciones?.nombre ?? '',
    naturaleza: r.naturaleza, fecha: r.fecha, usuarioId: r.usuario_id, usuarioNombre: null,
    estado: r.estado, nota: r.nota, createdAt: r.created_at,
  }
}

export async function listConteos(opts?: { estado?: 'abierto' | 'cerrado' }): Promise<Conteo[]> {
  let query = supabase
    .from('conteos')
    .select('id, ubicacion_id, naturaleza, fecha, usuario_id, estado, nota, created_at, ubicaciones(nombre)')
    .order('created_at', { ascending: false })
  if (opts?.estado) query = query.eq('estado', opts.estado)
  const { data, error } = await query
  if (error) throw new Error(`conteos.list: ${error.message}`)
  return (data as unknown as ConteoJoinRow[]).map(conteoFromJoinRow)
}

interface ConteoLineaJoinRow {
  id: string
  conteo_id: string
  material_id: string
  lote: string
  cantidad_contada: number
  cantidad_sistema: number
  primera_vez: boolean
  materiales: { sku: string; descripcion: string } | null
}

export async function getConteoLineas(conteoId: string): Promise<ConteoLinea[]> {
  const { data, error } = await supabase
    .from('conteo_lineas')
    .select('id, conteo_id, material_id, lote, cantidad_contada, cantidad_sistema, primera_vez, materiales(sku, descripcion)')
    .eq('conteo_id', conteoId)
    .order('lote')
  if (error) throw new Error(`conteo_lineas.list: ${error.message}`)
  return (data as unknown as ConteoLineaJoinRow[]).map((r) => ({
    id: r.id, conteoId: r.conteo_id, materialId: r.material_id,
    materialSku: r.materiales?.sku ?? '', materialDescripcion: r.materiales?.descripcion ?? '',
    lote: r.lote, cantidadContada: Number(r.cantidad_contada), cantidadSistema: Number(r.cantidad_sistema),
    primeraVez: r.primera_vez,
  }))
}

export async function abrirConteo(input: { ubicacionId: string; naturaleza: 'fisico' | 'digital'; nota?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('abrir_conteo', {
    p_ubicacion_id: input.ubicacionId, p_naturaleza: input.naturaleza, p_nota: input.nota ?? null,
  })
  if (error) throw new Error(`abrir_conteo: ${error.message}`)
  return data as string
}

export async function agregarLineaConteo(input: { conteoId: string; materialId: string; lote?: string }): Promise<string> {
  const { data, error } = await supabase.rpc('agregar_linea_conteo', {
    p_conteo_id: input.conteoId, p_material_id: input.materialId, p_lote: input.lote ?? null,
  })
  if (error) throw new Error(`agregar_linea_conteo: ${error.message}`)
  return data as string
}

export async function actualizarLineaConteo(lineaId: string, cantidadContada: number): Promise<void> {
  const { error } = await supabase.rpc('actualizar_linea_conteo', {
    p_linea_id: lineaId, p_cantidad_contada: cantidadContada,
  })
  if (error) throw new Error(`actualizar_linea_conteo: ${error.message}`)
}

export async function cerrarConteo(conteoId: string): Promise<void> {
  const { error } = await supabase.rpc('cerrar_conteo', { p_conteo_id: conteoId })
  if (error) throw new Error(`cerrar_conteo: ${error.message}`)
}

/** Solo válido para un conteo abierto — uno cerrado ya ajustó stock. */
export async function descartarConteo(conteoId: string): Promise<void> {
  const { error } = await supabase.rpc('descartar_conteo', { p_conteo_id: conteoId })
  if (error) throw new Error(`descartar_conteo: ${error.message}`)
}

const EVENTO_SELECT = `
  id, conteo_linea_id, material_id, ubicacion_id, lote, diferencia, estado, cantidad_resuelta,
  nota, resuelto_por, fecha_resolucion, created_at, movimiento_id,
  materiales(sku,descripcion), ubicaciones(nombre,tipo),
  movimientos(cantidad, fecha, project_id, usuario_id, projects(ott,area,subarea), profiles(nombre,email)),
  eventos_inventario_resoluciones(
    id, evento_id, tipo, cantidad, area, project_id, tecnico_user_id, ubicacion_id, nota, resuelto_por, created_at,
    projects(ott), tecnico:profiles!tecnico_user_id(nombre,email), ubicaciones(nombre)
  )
`

interface ResolucionJoinRow {
  id: string
  evento_id: string
  tipo: ResolucionTipo
  cantidad: number
  area: ConsumoArea | null
  project_id: string | null
  tecnico_user_id: string | null
  ubicacion_id: string | null
  nota: string | null
  resuelto_por: string | null
  created_at: string
  projects: { ott: string } | null
  tecnico: { nombre: string | null; email: string | null } | null
  ubicaciones: { nombre: string } | null
}

interface EventoJoinRow {
  id: string
  conteo_linea_id: string | null
  material_id: string
  ubicacion_id: string
  lote: string
  diferencia: number
  estado: 'abierto' | 'resuelto'
  cantidad_resuelta: number
  nota: string | null
  resuelto_por: string | null
  fecha_resolucion: string | null
  created_at: string
  movimiento_id: string | null
  materiales: { sku: string; descripcion: string } | null
  ubicaciones: { nombre: string; tipo: 'bodega' | 'tecnico' } | null
  movimientos: {
    cantidad: number; fecha: string; project_id: string | null; usuario_id: string | null
    projects: { ott: string; area: 'ATT' | 'OyM'; subarea: 'preventivo' | 'incidencia' | null } | null
    profiles: { nombre: string | null; email: string | null } | null
  } | null
  conteo_lineas: { conteo_id: string } | null
  eventos_inventario_resoluciones: ResolucionJoinRow[]
}

function eventoFromJoinRow(r: EventoJoinRow): EventoInventario {
  return {
    id: r.id, conteoLineaId: r.conteo_linea_id, conteoId: r.conteo_lineas?.conteo_id ?? null, materialId: r.material_id,
    materialSku: r.materiales?.sku ?? '', materialDescripcion: r.materiales?.descripcion ?? '',
    ubicacionId: r.ubicacion_id, ubicacionNombre: r.ubicaciones?.nombre ?? '', ubicacionTipo: r.ubicaciones?.tipo ?? 'bodega', lote: r.lote,
    diferencia: Number(r.diferencia), estado: r.estado, cantidadResuelta: Number(r.cantidad_resuelta), nota: r.nota,
    resueltoPor: r.resuelto_por, fechaResolucion: r.fecha_resolucion, createdAt: r.created_at,
    movimientoId: r.movimiento_id,
    origenMovimiento: r.movimientos ? {
      cantidad: Number(r.movimientos.cantidad), fecha: r.movimientos.fecha,
      projectId: r.movimientos.project_id, projectOtt: r.movimientos.projects?.ott ?? null,
      projectArea: r.movimientos.projects?.area ?? null, projectSubarea: r.movimientos.projects?.subarea ?? null,
      tecnicoUserId: r.movimientos.usuario_id,
      tecnicoNombre: r.movimientos.profiles?.nombre?.trim() || r.movimientos.profiles?.email || null,
    } : null,
    resoluciones: (r.eventos_inventario_resoluciones ?? [])
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((res) => ({
        id: res.id, eventoId: res.evento_id, tipo: res.tipo, cantidad: Number(res.cantidad), area: res.area,
        projectId: res.project_id, projectOtt: res.projects?.ott ?? null,
        tecnicoUserId: res.tecnico_user_id, tecnicoNombre: res.tecnico?.nombre?.trim() || res.tecnico?.email || null,
        ubicacionId: res.ubicacion_id, ubicacionNombre: res.ubicaciones?.nombre ?? null,
        nota: res.nota, resueltoPor: res.resuelto_por, createdAt: res.created_at,
      })),
  }
}

export async function listEventosInventario(opts?: { estado?: 'abierto' | 'resuelto' }): Promise<EventoInventario[]> {
  let query = supabase.from('eventos_inventario').select(`${EVENTO_SELECT}, conteo_lineas(conteo_id)`).order('created_at', { ascending: false })
  if (opts?.estado) query = query.eq('estado', opts.estado)
  const { data, error } = await query
  if (error) throw new Error(`eventos_inventario.list: ${error.message}`)
  return (data as unknown as EventoJoinRow[]).map(eventoFromJoinRow)
}

/** Todos los eventos de UN conteo (abiertos y resueltos) — para mostrarlos al entrar a ese conteo. */
export async function listEventosPorConteo(conteoId: string): Promise<EventoInventario[]> {
  const { data, error } = await supabase
    .from('eventos_inventario')
    .select(`${EVENTO_SELECT}, conteo_lineas!inner(conteo_id)`)
    .eq('conteo_lineas.conteo_id', conteoId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`eventos_inventario.listPorConteo: ${error.message}`)
  return (data as unknown as EventoJoinRow[]).map(eventoFromJoinRow)
}

/** Resuelve una parte (o el total) de la diferencia de un evento — puede llamarse varias veces hasta completar. */
export async function resolverEvento(eventoId: string, input: ResolverEventoInput): Promise<void> {
  const { error } = await supabase.rpc('resolver_evento_parcial', {
    p_evento_id: eventoId,
    p_tipo: input.tipo,
    p_cantidad: input.cantidad,
    p_area: input.area ?? null,
    p_project_id: input.projectId ?? null,
    p_tecnico_user_id: input.tecnicoUserId ?? null,
    p_ubicacion_id: input.ubicacionId ?? null,
    p_nota: input.nota ?? null,
  })
  if (error) throw new Error(`resolver_evento_parcial: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Observaciones (pestaña "Observaciones" de Logística) — entradas libres,
// solo agregar/borrar. Sirven, entre otras cosas, para que un técnico avise
// de material instalado que no quedó registrado como entregado, y oficina lo
// corrija por su cuenta (ver supabase/migrations/0016_observaciones.sql).
// ---------------------------------------------------------------------------

interface ObservacionJoinRow {
  id: string
  project_id: string
  punto_id: string | null
  usuario_id: string
  texto: string
  created_at: string
  profiles: { nombre: string | null; email: string | null } | null
}

/**
 * `puntoId` por defecto `null` = comentarios generales del proyecto (mismo
 * comportamiento de siempre). Con un id de punto, trae solo los de ESE punto
 * — nunca se mezclan (evita que "Comentarios" general se llene con notas de
 * cada punto, y viceversa).
 */
export async function listObservaciones(projectId: string, puntoId: string | null = null): Promise<Observacion[]> {
  let query = supabase
    .from('observaciones')
    .select('id, project_id, punto_id, usuario_id, texto, created_at, profiles(nombre, email)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  query = puntoId ? query.eq('punto_id', puntoId) : query.is('punto_id', null)
  const { data, error } = await query
  if (error) throw new Error(`observaciones.list: ${error.message}`)
  return (data as unknown as ObservacionJoinRow[]).map((r) => ({
    id: r.id, projectId: r.project_id, puntoId: r.punto_id, usuarioId: r.usuario_id,
    usuarioNombre: r.profiles?.nombre?.trim() || r.profiles?.email || null,
    texto: r.texto, createdAt: r.created_at,
  }))
}

/** `usuario_id` lo pone la BD (`default auth.uid()`) — no se manda desde el cliente. */
export async function agregarObservacion(projectId: string, texto: string, puntoId: string | null = null): Promise<void> {
  const { error } = await supabase.from('observaciones').insert({ project_id: projectId, texto: texto.trim(), punto_id: puntoId })
  if (error) throw new Error(`observaciones.agregar: ${error.message}`)
}

/** La RLS solo deja borrar la propia (o cualquiera, si eres jp/admin). */
export async function eliminarObservacion(id: string): Promise<void> {
  const { error } = await supabase.from('observaciones').delete().eq('id', id)
  if (error) throw new Error(`observaciones.eliminar: ${error.message}`)
}

export interface ImportarSapResultado {
  total: number
  materialesCreados: number
  lineasCreadas: number
  lineasActualizadas: number
  errores: { fila: FilaImportSap; mensaje: string }[]
}

/**
 * Vuelca filas ya parseadas de un Excel SAP (ver ../inventario/importarSap.ts)
 * dentro de un conteo abierto: crea los materiales que falten (por sku, en
 * un solo insert) y llena cantidad_contada de cada línea (agregándola si no
 * estaba en la foto inicial del conteo) con una única llamada RPC
 * (importar_lineas_conteo) que hace el loop fila-por-fila en la BD, no por
 * la red. Antes eran 2-4 viajes de red POR FILA (buscar/crear material +
 * agregar/actualizar línea, todo secuencial) — con un Excel de unos cientos
 * de filas eso eran cientos de round-trips uno detrás de otro. Ahora son 3
 * llamadas en total sin importar el tamaño del archivo.
 */
export async function importarFilasSapAConteo(
  conteoId: string,
  filas: FilaImportSap[],
  onPhase?: (phase: 'materiales' | 'lineas') => void,
): Promise<ImportarSapResultado> {
  onPhase?.('materiales')
  const skusUnicos = [...new Set(filas.map((f) => f.sku))]
  const { data: existentes, error: findErr } = await supabase.from('materiales').select('id, sku').in('sku', skusUnicos)
  if (findErr) throw new Error(`materiales.bulkFind: ${findErr.message}`)
  const materialIdBySku = new Map((existentes as { id: string; sku: string }[]).map((m) => [m.sku, m.id]))

  const faltantes = skusUnicos.filter((sku) => !materialIdBySku.has(sku))
  if (faltantes.length > 0) {
    const rows = faltantes.map((sku) => ({
      sku, descripcion: filas.find((f) => f.sku === sku)?.descripcion || sku, activo: true,
    }))
    const { data: creados, error: insErr } = await supabase.from('materiales').insert(rows).select('id, sku')
    if (insErr) throw new Error(`materiales.bulkInsert: ${insErr.message}`)
    for (const m of creados as { id: string; sku: string }[]) materialIdBySku.set(m.sku, m.id)
  }

  onPhase?.('lineas')
  const payload = filas
    .filter((f) => materialIdBySku.has(f.sku))
    .map((f) => ({ material_id: materialIdBySku.get(f.sku), lote: f.lote, cantidad: f.cantidad }))

  const { data, error } = await supabase.rpc('importar_lineas_conteo', { p_conteo_id: conteoId, p_filas: payload })
  if (error) throw new Error(`importar_lineas_conteo: ${error.message}`)

  const filaPorClave = new Map(filas.map((f) => [`${materialIdBySku.get(f.sku)}|${f.lote}`, f]))
  const resultado: ImportarSapResultado = {
    total: filas.length, materialesCreados: faltantes.length, lineasCreadas: 0, lineasActualizadas: 0, errores: [],
  }
  for (const r of data as { material_id: string; lote: string; accion: string; mensaje: string | null }[]) {
    if (r.accion === 'creada') resultado.lineasCreadas++
    else if (r.accion === 'actualizada') resultado.lineasActualizadas++
    else {
      const fila = filaPorClave.get(`${r.material_id}|${r.lote}`)
      resultado.errores.push({ fila: fila ?? { sku: '', descripcion: '', lote: r.lote, cantidad: 0 }, mensaje: r.mensaje ?? 'Error desconocido' })
    }
  }
  return resultado
}
