// Capa de datos del Estado de Pago (EP) — ver src/lib/ep/types.ts.

import { supabase } from '../supabaseClient'
import { getResumenProyecto, listMateriales } from '../inventario/inventarioRepo'
import { listLpuMaterialMapPorMateriales, listPreciosPorZona } from '../lpu/lpuRepo'
import type { AvanceEp, EpInforme, EpLinea, EpLineaInput, EpLineaSugerida, MaterialSinLpu } from './types'

interface EpInformeRow {
  id: string
  project_id: string
  zona: string | null
  estado: 'borrador' | 'guardado'
  created_at: string
  updated_at: string
}

function epInformeFromRow(r: EpInformeRow): EpInforme {
  return { id: r.id, projectId: r.project_id, zona: r.zona, estado: r.estado, createdAt: r.created_at, updatedAt: r.updated_at }
}

/** Trae el EP del proyecto si ya existe; si no, lo crea (zona por defecto RM-CENTRO). Uno por OTT (unique en project_id). */
export async function getOrCrearEpInforme(projectId: string): Promise<EpInforme> {
  const { data, error } = await supabase.from('ep_informes').select('*').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(`ep_informes.get: ${error.message}`)
  if (data) return epInformeFromRow(data as EpInformeRow)

  const { data: creado, error: errCrear } = await supabase.from('ep_informes')
    .insert({ project_id: projectId, zona: 'RM-CENTRO' }).select('*').single()
  if (errCrear) {
    // select-then-insert no es atómico: si esta función se llama dos veces casi
    // a la vez (ej. doble efecto de React en desarrollo), ambas pueden no
    // encontrar fila y ambas intentar crearla — la segunda choca contra el
    // unique(project_id). En vez de fallar, se trae la fila que la otra ya creó.
    if (errCrear.code === '23505') {
      const { data: existente, error: errGet2 } = await supabase.from('ep_informes').select('*').eq('project_id', projectId).single()
      if (errGet2) throw new Error(`ep_informes.crear (tras choque de duplicado): ${errGet2.message}`)
      return epInformeFromRow(existente as EpInformeRow)
    }
    throw new Error(`ep_informes.crear: ${errCrear.message}`)
  }
  return epInformeFromRow(creado as EpInformeRow)
}

export async function actualizarZonaEpInforme(id: string, zona: string): Promise<void> {
  const { error } = await supabase.from('ep_informes').update({ zona }).eq('id', id)
  if (error) throw new Error(`ep_informes.actualizarZona: ${error.message}`)
}

interface EpLineaRow {
  id: string
  ep_informe_id: string
  lpu_codigo_id: string | null
  codigo_att: string
  descripcion: string
  unidad: string | null
  precio_unitario: number
  cantidad: number
  observaciones: string | null
  tipo_tendido?: string | null
  origen: 'auto' | 'manual'
  orden: number
}

function epLineaFromRow(r: EpLineaRow): EpLinea {
  return {
    id: r.id, epInformeId: r.ep_informe_id, lpuCodigoId: r.lpu_codigo_id,
    codigoAtt: r.codigo_att, descripcion: r.descripcion, unidad: r.unidad,
    precioUnitario: Number(r.precio_unitario), cantidad: Number(r.cantidad),
    observaciones: r.observaciones, tipoTendido: r.tipo_tendido ?? null,
    origen: r.origen, orden: r.orden,
  }
}

export async function listEpLineas(epInformeId: string): Promise<EpLinea[]> {
  const { data, error } = await supabase.from('ep_lineas').select('*').eq('ep_informe_id', epInformeId).order('orden')
  if (error) throw new Error(`ep_lineas.list: ${error.message}`)
  return (data as EpLineaRow[]).map(epLineaFromRow)
}

/** Reemplaza TODAS las líneas del EP por el set actual (lo que el JP confirmó en pantalla) — sin historial parcial, se regenera completo cada vez que se guarda. */
export async function guardarEpLineas(epInformeId: string, lineas: EpLineaInput[]): Promise<void> {
  const { error: errDel } = await supabase.from('ep_lineas').delete().eq('ep_informe_id', epInformeId)
  if (errDel) throw new Error(`ep_lineas.guardar (borrar previas): ${errDel.message}`)

  if (lineas.length > 0) {
    const { error: errIns } = await supabase.from('ep_lineas').insert(
      lineas.map((l, i) => ({
        ep_informe_id: epInformeId, lpu_codigo_id: l.lpuCodigoId, codigo_att: l.codigoAtt,
        descripcion: l.descripcion, unidad: l.unidad, precio_unitario: l.precioUnitario,
        cantidad: l.cantidad, observaciones: l.observaciones ?? null,
        tipo_tendido: l.tipoTendido?.trim() || null, origen: l.origen, orden: i,
      })),
    )
    if (errIns) throw new Error(`ep_lineas.guardar (insertar): ${errIns.message}`)
  }

  const { error: errEstado } = await supabase.from('ep_informes').update({ estado: 'guardado' }).eq('id', epInformeId)
  if (errEstado) throw new Error(`ep_informes.marcarGuardado: ${errEstado.message}`)
}


/**
 * Recalcula en vivo las líneas sugeridas para un proyecto, en una zona dada.
 * Única fuente: materiales instalados → `lpu_material_map` (cantidad =
 * cant_instalada × factor_cantidad, sumado por código + tipo de tendido).
 *
 * El tendido NO tiene lógica aparte: el cable instalado (en metros) es un
 * material más, con su código LPU asignado en el Catálogo. Si el material
 * tiene `tipoTendido`, la línea lo lleva — es la 4ª columna manual del Excel
 * de Entel. Los materiales instalados sin ningún código LPU activo no
 * generan línea y se devuelven en `sinLpu` para avisarle al JP.
 * Eventos/Hitos: fuera del alcance.
 */
export async function calcularAvanceEp(projectId: string, zona: string): Promise<AvanceEp> {
  const [resumen, materiales, precios] = await Promise.all([
    getResumenProyecto(projectId),
    listMateriales(),
    listPreciosPorZona(zona),
  ])
  const materialPorId = new Map(materiales.map((m) => [m.id, m]))

  // Lo instalado por material (el resumen viene por lote/punto).
  const instaladoPorMaterial = new Map<string, number>()
  for (const r of resumen) {
    if (r.cantInstalada > 0) instaladoPorMaterial.set(r.materialId, (instaladoPorMaterial.get(r.materialId) ?? 0) + r.cantInstalada)
  }

  const mapeos = await listLpuMaterialMapPorMateriales([...instaladoPorMaterial.keys()])
  const mapeosPorMaterial = new Map<string, typeof mapeos>()
  for (const m of mapeos) {
    if (!m.lpuCodigo) continue
    const lista = mapeosPorMaterial.get(m.materialId) ?? []
    lista.push(m)
    mapeosPorMaterial.set(m.materialId, lista)
  }

  const lineas = new Map<string, EpLineaSugerida>()
  const sinLpu: MaterialSinLpu[] = []

  for (const [materialId, instalado] of instaladoPorMaterial) {
    const material = materialPorId.get(materialId)
    const maps = mapeosPorMaterial.get(materialId) ?? []
    if (maps.length === 0) {
      sinLpu.push({ sku: material?.sku ?? materialId, descripcion: material?.descripcion ?? '', cantidad: instalado })
      continue
    }
    const tipoTendido = material?.tipoTendido?.trim() || null
    for (const map of maps) {
      const codigo = map.lpuCodigo!
      // Mismo código con distinto tipo de tendido = líneas separadas (el Excel lleva el tipo por línea).
      const key = `${map.lpuCodigoId}|${tipoTendido ?? ''}`
      const existente = lineas.get(key)
      const cantidad = instalado * map.factorCantidad
      if (existente) { existente.cantidad += cantidad; continue }
      lineas.set(key, {
        lpuCodigoId: map.lpuCodigoId, codigoAtt: codigo.codigoAtt,
        descripcion: codigo.partida || codigo.descripcion, unidad: codigo.unidad,
        precioUnitario: precios.get(map.lpuCodigoId) ?? 0, cantidad, tipoTendido,
      })
    }
  }

  sinLpu.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
  return { lineas: [...lineas.values()].sort((a, b) => a.codigoAtt.localeCompare(b.codigoAtt)), sinLpu }
}
