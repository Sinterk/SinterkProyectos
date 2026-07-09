// Capa de datos compartida de Inventario — usada por la ventana Inventario y
// por las pestañas "Logística" de ATT/Preventivos. La lógica de negocio de
// "registrar un movimiento" vive en la base de datos (funciones
// registrar_movimiento / reasignar_transito_a_preventivo, ver
// supabase/migrations/0005_registrar_movimiento.sql) por atomicidad y
// permisos; este archivo solo hace lecturas + wrappers tipados de esas RPC.

import { supabase } from '../supabaseClient'
import type {
  Material, Ubicacion, UbicacionTipo, StockRow, Movimiento,
  RegistrarMovimientoInput, ReasignarTransitoInput,
  ResumenMaterialProyecto, TecnicoLedgerRow,
  Conteo, ConteoLinea, EventoInventario, ResolucionEvento,
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
}

function materialFromRow(m: MaterialRow): Material {
  return {
    id: m.id, sku: m.sku, descripcion: m.descripcion, apodo: m.apodo,
    unidad: m.unidad, categoria: m.categoria,
    controlaLoteFisico: m.controla_lote_fisico, activo: m.activo,
    stockMinimo: m.stock_minimo === null ? null : Number(m.stock_minimo),
  }
}

/** Todos los materiales activos. El filtrado por texto (SKU/descripción/apodo) se hace en el cliente. */
export async function listMateriales(): Promise<Material[]> {
  const { data, error } = await supabase.from('materiales').select('*').eq('activo', true).order('sku')
  if (error) throw new Error(`materiales.list: ${error.message}`)
  return (data as MaterialRow[]).map(materialFromRow)
}

/** Umbral de alerta ("hay que renovar") — null para quitarlo. */
export async function updateMaterialStockMinimo(materialId: string, stockMinimo: number | null): Promise<void> {
  const { error } = await supabase.from('materiales').update({ stock_minimo: stockMinimo }).eq('id', materialId)
  if (error) throw new Error(`materiales.updateStockMinimo: ${error.message}`)
}

/** Busca un material por sku; si no existe, lo crea con esa descripción (import de Excel SAP). */
export async function ensureMaterialBySku(sku: string, descripcion: string): Promise<Material> {
  const { data: existing, error: findErr } = await supabase.from('materiales').select('*').eq('sku', sku).maybeSingle()
  if (findErr) throw new Error(`materiales.ensureBySku: ${findErr.message}`)
  if (existing) return materialFromRow(existing as MaterialRow)
  const { data, error } = await supabase.from('materiales')
    .insert({ sku, descripcion: descripcion || sku, activo: true }).select('*').single()
  if (error) throw new Error(`materiales.ensureBySku insert: ${error.message}`)
  return materialFromRow(data as MaterialRow)
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
  materiales: { sku: string; descripcion: string; stock_minimo: number | null } | null
}

/** Filtro por ubicación/material/lote exactos; `search` filtra en el cliente sobre nombre/sku/descripción. */
export async function getStock(opts?: {
  ubicacionId?: string; materialId?: string; lote?: string; search?: string
}): Promise<StockRow[]> {
  let query = supabase
    .from('stock')
    .select('ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital, ubicaciones(nombre), materiales(sku, descripcion, stock_minimo)')
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
  lote: string
  naturaleza: 'fisico' | 'digital'
  tipo: string
  cantidad: number
  project_id: string | null
  punto_id: string | null
  usuario_id: string | null
  fecha: string
  nota: string | null
  proveedor: string | null
  documento: string | null
  created_at: string
  materiales: { sku: string; descripcion: string } | null
  ubicaciones: { nombre: string } | null
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
    ubicacionNombre: r.ubicaciones?.nombre ?? '',
    lote: r.lote,
    naturaleza: r.naturaleza,
    tipo: r.tipo,
    cantidad: Number(r.cantidad),
    projectId: r.project_id,
    projectOtt: r.projects?.ott ?? null,
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
    .select('*, materiales(sku,descripcion), ubicaciones(nombre), profiles(nombre,email), projects(ott)')
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
  lote: string
  naturaleza: 'fisico' | 'digital'
  tipo: string
  cantidad: number
  projectId: string | null
  puntoId: string | null
  usuarioId: string | null
  fecha: string
}

interface MovimientoRpcRow {
  id: string; material_id: string; ubicacion_id: string; lote: string
  naturaleza: 'fisico' | 'digital'; tipo: string; cantidad: number
  project_id: string | null; punto_id: string | null; usuario_id: string | null; fecha: string
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
  })
  if (error) throw new Error(`registrar_movimiento: ${error.message}`)
  const row = data as MovimientoRpcRow
  return {
    id: row.id, materialId: row.material_id, ubicacionId: row.ubicacion_id, lote: row.lote,
    naturaleza: row.naturaleza, tipo: row.tipo, cantidad: Number(row.cantidad),
    projectId: row.project_id, puntoId: row.punto_id, usuarioId: row.usuario_id, fecha: row.fecha,
  }
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
      .select('material_id, lote, punto_id, cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada, materiales(sku, descripcion)')
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
        cantTransito: 0,
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
  }

  for (const r of (solRes.data as unknown as SolicitudJoinRow[])) {
    const row = ensure(r.material_id, r.lote, r.punto_id, r.materiales)
    row.cantSolicitada += Number(r.cantidad)
  }

  for (const row of map.values()) {
    row.cantTransito = row.cantEntregada - row.cantInstalada - row.cantDevuelta - row.cantRezagada
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
    .in('tipo', ['salida', 'instalado', 'traslado', 'rebaja'])
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
        cantEntregada: 0, cantInstalada: 0, cantDevuelta: 0, cantRebajada: 0, cantTransito: 0,
      }
      map.set(k, row)
    }
    const cantidad = Number(r.cantidad)
    if (r.tipo === 'salida') row.cantEntregada += cantidad
    else if (r.tipo === 'instalado') row.cantInstalada += cantidad
    else if (r.tipo === 'traslado') row.cantDevuelta += cantidad
    else if (r.tipo === 'rebaja') row.cantRebajada += cantidad
  }

  for (const row of map.values()) {
    row.cantTransito = row.cantEntregada - row.cantInstalada - row.cantDevuelta - row.cantRebajada
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
  materiales: { sku: string; descripcion: string } | null
}

export async function getConteoLineas(conteoId: string): Promise<ConteoLinea[]> {
  const { data, error } = await supabase
    .from('conteo_lineas')
    .select('id, conteo_id, material_id, lote, cantidad_contada, cantidad_sistema, materiales(sku, descripcion)')
    .eq('conteo_id', conteoId)
    .order('lote')
  if (error) throw new Error(`conteo_lineas.list: ${error.message}`)
  return (data as unknown as ConteoLineaJoinRow[]).map((r) => ({
    id: r.id, conteoId: r.conteo_id, materialId: r.material_id,
    materialSku: r.materiales?.sku ?? '', materialDescripcion: r.materiales?.descripcion ?? '',
    lote: r.lote, cantidadContada: Number(r.cantidad_contada), cantidadSistema: Number(r.cantidad_sistema),
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

interface EventoJoinRow {
  id: string
  conteo_linea_id: string | null
  material_id: string
  ubicacion_id: string
  lote: string
  diferencia: number
  estado: 'abierto' | 'resuelto'
  resolucion: ResolucionEvento | null
  nota: string | null
  resuelto_por: string | null
  fecha_resolucion: string | null
  created_at: string
  materiales: { sku: string; descripcion: string } | null
  ubicaciones: { nombre: string } | null
}

export async function listEventosInventario(opts?: { estado?: 'abierto' | 'resuelto' }): Promise<EventoInventario[]> {
  let query = supabase
    .from('eventos_inventario')
    .select('id, conteo_linea_id, material_id, ubicacion_id, lote, diferencia, estado, resolucion, nota, resuelto_por, fecha_resolucion, created_at, materiales(sku,descripcion), ubicaciones(nombre)')
    .order('created_at', { ascending: false })
  if (opts?.estado) query = query.eq('estado', opts.estado)
  const { data, error } = await query
  if (error) throw new Error(`eventos_inventario.list: ${error.message}`)
  return (data as unknown as EventoJoinRow[]).map((r) => ({
    id: r.id, conteoLineaId: r.conteo_linea_id, materialId: r.material_id,
    materialSku: r.materiales?.sku ?? '', materialDescripcion: r.materiales?.descripcion ?? '',
    ubicacionId: r.ubicacion_id, ubicacionNombre: r.ubicaciones?.nombre ?? '', lote: r.lote,
    diferencia: Number(r.diferencia), estado: r.estado, resolucion: r.resolucion, nota: r.nota,
    resueltoPor: r.resuelto_por, fechaResolucion: r.fecha_resolucion, createdAt: r.created_at,
  }))
}

export async function resolverEventoInventario(eventoId: string, resolucion: ResolucionEvento, nota?: string): Promise<void> {
  const { error } = await supabase.rpc('resolver_evento_inventario', {
    p_evento_id: eventoId, p_resolucion: resolucion, p_nota: nota ?? null,
  })
  if (error) throw new Error(`resolver_evento_inventario: ${error.message}`)
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
 * dentro de un conteo abierto: crea los materiales que falten (por sku) y
 * llena cantidad_contada de cada línea (agregándola si no estaba en la foto
 * inicial del conteo). Secuencial a propósito — son llamadas RPC una por
 * línea, igual que el envío por línea de RegistrarMovimientoForm.
 */
export async function importarFilasSapAConteo(
  conteoId: string,
  filas: FilaImportSap[],
  onProgress?: (hecho: number, total: number) => void,
): Promise<ImportarSapResultado> {
  const [lineasExistentes, materialesExistentes] = await Promise.all([getConteoLineas(conteoId), listMateriales()])
  const skusExistentes = new Set(materialesExistentes.map((m) => m.sku))
  const lineasPorClave = new Map(lineasExistentes.map((l) => [`${l.materialId}|${l.lote}`, l]))

  const resultado: ImportarSapResultado = {
    total: filas.length,
    materialesCreados: filas.filter((f) => !skusExistentes.has(f.sku)).length,
    lineasCreadas: 0, lineasActualizadas: 0, errores: [],
  }

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i]
    try {
      const material = await ensureMaterialBySku(fila.sku, fila.descripcion)
      const clave = `${material.id}|${fila.lote}`
      const existente = lineasPorClave.get(clave)
      if (existente) {
        await actualizarLineaConteo(existente.id, fila.cantidad)
        resultado.lineasActualizadas++
      } else {
        const lineaId = await agregarLineaConteo({ conteoId, materialId: material.id, lote: fila.lote })
        await actualizarLineaConteo(lineaId, fila.cantidad)
        lineasPorClave.set(clave, {
          id: lineaId, conteoId, materialId: material.id, materialSku: material.sku,
          materialDescripcion: material.descripcion, lote: fila.lote,
          cantidadContada: fila.cantidad, cantidadSistema: 0,
        })
        resultado.lineasCreadas++
      }
    } catch (err) {
      resultado.errores.push({ fila, mensaje: err instanceof Error ? err.message : String(err) })
    }
    onProgress?.(i + 1, filas.length)
  }
  return resultado
}
