// Capa de datos del Estado de Pago (EP) — ver src/lib/ep/types.ts.

import { supabase } from '../supabaseClient'
import { getResumenProyecto, listMateriales } from '../inventario/inventarioRepo'
import { listLpuMaterialMapPorMateriales, listLpuTendidoMap, listPreciosPorZona } from '../lpu/lpuRepo'
import type { EpInforme, EpLinea, EpLineaInput, EpLineaSugerida } from './types'

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
  origen: 'auto' | 'manual'
  orden: number
}

function epLineaFromRow(r: EpLineaRow): EpLinea {
  return {
    id: r.id, epInformeId: r.ep_informe_id, lpuCodigoId: r.lpu_codigo_id,
    codigoAtt: r.codigo_att, descripcion: r.descripcion, unidad: r.unidad,
    precioUnitario: Number(r.precio_unitario), cantidad: Number(r.cantidad),
    observaciones: r.observaciones, origen: r.origen, orden: r.orden,
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
        cantidad: l.cantidad, observaciones: l.observaciones ?? null, origen: l.origen, orden: i,
      })),
    )
    if (errIns) throw new Error(`ep_lineas.guardar (insertar): ${errIns.message}`)
  }

  const { error: errEstado } = await supabase.from('ep_informes').update({ estado: 'guardado' }).eq('id', epInformeId)
  if (errEstado) throw new Error(`ep_informes.marcarGuardado: ${errEstado.message}`)
}

/**
 * Recalcula en vivo las líneas sugeridas para un proyecto, en una zona dada:
 * (a) materiales instalados → lpu_material_map (cantidad = cant_instalada × factor_cantidad, sumado por código)
 * (b) metros tendidos → lpu_tendido_map, SOLO si hay exactamente un material
 *     de cable instalado en el proyecto (con tipo_tendido configurado) —
 *     si hay cero o más de uno, se omite y el JP agrega esa línea a mano
 *     (mismo criterio que el diseño original: cable reutilizado retirado de
 *     otro sitio no es material "nuevo" de bodega, no hay forma de saber cuál
 *     tendido usar sin ambigüedad).
 * (c) Eventos/Hitos: deliberadamente NO incluido (ver types.ts).
 */
export async function calcularAvanceEp(
  projectId: string,
  zona: string,
  tramos: { tipoCable: string; metraje: string }[],
): Promise<EpLineaSugerida[]> {
  const [resumen, materiales, precios] = await Promise.all([
    getResumenProyecto(projectId),
    listMateriales(),
    listPreciosPorZona(zona),
  ])
  const materialPorId = new Map(materiales.map((m) => [m.id, m]))
  const cantidadPorCodigo = new Map<string, number>()
  const infoPorCodigo = new Map<string, { codigoAtt: string; descripcion: string; unidad: string | null }>()

  function acumular(lpuCodigoId: string, codigoAtt: string, descripcion: string, unidad: string | null, cantidad: number) {
    cantidadPorCodigo.set(lpuCodigoId, (cantidadPorCodigo.get(lpuCodigoId) ?? 0) + cantidad)
    if (!infoPorCodigo.has(lpuCodigoId)) infoPorCodigo.set(lpuCodigoId, { codigoAtt, descripcion, unidad })
  }

  // (a) materiales instalados
  const instalados = resumen.filter((r) => r.cantInstalada > 0)
  const materialIds = [...new Set(instalados.map((r) => r.materialId))]
  const mapeos = await listLpuMaterialMapPorMateriales(materialIds)
  const mapeosPorMaterial = new Map<string, typeof mapeos>()
  for (const m of mapeos) {
    const lista = mapeosPorMaterial.get(m.materialId) ?? []
    lista.push(m)
    mapeosPorMaterial.set(m.materialId, lista)
  }
  for (const r of instalados) {
    for (const map of mapeosPorMaterial.get(r.materialId) ?? []) {
      if (!map.lpuCodigo) continue
      acumular(map.lpuCodigoId, map.lpuCodigo.codigoAtt, map.lpuCodigo.partida || map.lpuCodigo.descripcion, map.lpuCodigo.unidad, r.cantInstalada * map.factorCantidad)
    }
  }

  // (b) metros tendidos — solo si el proyecto instaló exactamente un material de cable
  const materialesCable = [...new Set(instalados.map((r) => r.materialId))]
    .map((id) => materialPorId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.tipoTendido !== null)
  if (materialesCable.length === 1) {
    const cable = materialesCable[0]
    const tendidos = (await listLpuTendidoMap()).filter((t) =>
      t.activo && t.tipoTendido === cable.tipoTendido &&
      (t.capacidadMin === null || (cable.capacidad ?? -Infinity) >= t.capacidadMin) &&
      (t.capacidadMax === null || (cable.capacidad ?? Infinity) <= t.capacidadMax),
    )
    const tendidoMap = tendidos[0]
    if (tendidoMap?.lpuCodigo) {
      const metrosTotal = tramos.reduce((sum, t) => sum + (Number(t.metraje) || 0), 0)
      if (metrosTotal > 0) {
        acumular(tendidoMap.lpuCodigoId, tendidoMap.lpuCodigo.codigoAtt, tendidoMap.lpuCodigo.partida || tendidoMap.lpuCodigo.descripcion, tendidoMap.lpuCodigo.unidad, metrosTotal)
      }
    }
  }

  return [...cantidadPorCodigo.entries()].map(([lpuCodigoId, cantidad]) => {
    const info = infoPorCodigo.get(lpuCodigoId)!
    return { lpuCodigoId, codigoAtt: info.codigoAtt, descripcion: info.descripcion, unidad: info.unidad, precioUnitario: precios.get(lpuCodigoId) ?? 0, cantidad }
  })
}
