// Cálculo de "qué falta rebajar y de qué lote" para un proyecto — usado por
// "↻ Sugerir rebaja" (un proyecto, ResumenProyectoTable) y por la rebaja
// masiva de incidencias OyM (varios proyectos a la vez, ver rebajaMasiva.ts).
//
// Reglas (pedidos explícitos de Andrés, ver docs/REGLAS-DE-NEGOCIO.md §9):
//  - Solo se mira el stock digital de la bodega del área; nunca otras. Si no
//    alcanza, la línea queda con el faltante y SIN lote, para completar a mano.
//  - CABLE nunca se reparte entre lotes: con lote físico real se rebaja contra
//    ESE lote; sin lote, se busca UN lote digital que cubra todo.
//  - Lo demás se agrupa por material y se reparte entre los lotes digitales,
//    de menor a mayor cantidad.
//
// `LibroStock` es el stock digital disponible, cargado una vez por material y
// descontado a medida que se asigna: con varias incidencias en la misma
// corrida, la segunda ya no ve el lote que la primera se llevó.

import { esTipoCable } from './esCable'
import { getStock } from './inventarioRepo'
import type { Material, ResumenMaterialProyecto } from './types'

export interface LineaRebajaCalculada {
  materialId: string
  materialSku: string
  materialDescripcion: string
  /** Vacío = no hay stock digital suficiente en la bodega del área (completar a mano). */
  lote: string
  ubicacionBodegaId: string
  cantidad: number
}

interface LoteDisponible { ubicacionId: string; lote: string; disponible: number }
export type LibroStock = Map<string, LoteDisponible[]>

export function nuevoLibroStock(): LibroStock {
  return new Map()
}

async function lotesDe(libro: LibroStock, materialId: string, bodegaId: string): Promise<LoteDisponible[]> {
  let lotes = libro.get(materialId)
  if (!lotes) {
    const stock = await getStock({ materialId, ubicacionId: bodegaId })
    lotes = stock.map((s) => ({ ubicacionId: s.ubicacionId, lote: s.lote, disponible: s.cantidadDigital }))
    libro.set(materialId, lotes)
  }
  return lotes
}

const redondear = (n: number) => Math.round(n * 100) / 100

export async function calcularLineasRebaja(opts: {
  rows: ResumenMaterialProyecto[]
  materiales: Material[]
  bodegaId: string
  libro: LibroStock
}): Promise<LineaRebajaCalculada[]> {
  const { rows, materiales, bodegaId, libro } = opts
  const out: LineaRebajaCalculada[] = []

  const filasCable: ResumenMaterialProyecto[] = []
  const filasResto: ResumenMaterialProyecto[] = []
  for (const row of rows) {
    const tipoNombre = materiales.find((m) => m.id === row.materialId)?.tipo?.nombre
    ;(esTipoCable(tipoNombre) ? filasCable : filasResto).push(row)
  }

  for (const row of filasCable) {
    const necesario = redondear(row.cantInstalada - row.cantRebajada)
    if (necesario <= 0) continue

    if (row.lote && row.lote !== 'SinDefinir') {
      out.push({
        materialId: row.materialId, materialSku: row.materialSku, materialDescripcion: row.materialDescripcion,
        lote: row.lote, ubicacionBodegaId: bodegaId, cantidad: necesario,
      })
      continue
    }

    const lotes = await lotesDe(libro, row.materialId, bodegaId)
    const candidato = lotes
      .filter((l) => l.disponible >= necesario)
      .sort((a, b) => a.disponible - b.disponible)[0]
    if (candidato) candidato.disponible -= necesario
    out.push({
      materialId: row.materialId, materialSku: row.materialSku, materialDescripcion: row.materialDescripcion,
      lote: candidato?.lote ?? '', ubicacionBodegaId: bodegaId, cantidad: necesario,
    })
  }

  const necesarioPorMaterial = new Map<string, { sku: string; descripcion: string; necesario: number }>()
  for (const row of filasResto) {
    const acc = necesarioPorMaterial.get(row.materialId) ?? { sku: row.materialSku, descripcion: row.materialDescripcion, necesario: 0 }
    acc.necesario += row.cantInstalada - row.cantRebajada
    necesarioPorMaterial.set(row.materialId, acc)
  }
  for (const [materialId, info] of necesarioPorMaterial) {
    let restante = redondear(info.necesario)
    if (restante <= 0) continue

    const lotes = (await lotesDe(libro, materialId, bodegaId))
      .filter((l) => l.disponible > 0)
      .sort((a, b) => a.disponible - b.disponible)

    for (const l of lotes) {
      if (restante <= 0) break
      const usar = Math.min(l.disponible, restante)
      out.push({
        materialId, materialSku: info.sku, materialDescripcion: info.descripcion,
        lote: l.lote, ubicacionBodegaId: l.ubicacionId, cantidad: redondear(usar),
      })
      l.disponible -= usar
      restante = redondear(restante - usar)
    }
    if (restante > 0) {
      out.push({
        materialId, materialSku: info.sku, materialDescripcion: info.descripcion,
        lote: '', ubicacionBodegaId: bodegaId, cantidad: restante,
      })
    }
  }

  return out
}
