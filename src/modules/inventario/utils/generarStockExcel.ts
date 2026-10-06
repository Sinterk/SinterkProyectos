// Excel de stock (Físico/Digital) por bodega — mismo patrón que
// generarLevantamiento.ts (xlsx-js-style, hoja simple AOA + estilo celda por
// celda), no el patrón de plantilla de generarInformeEntel.ts: acá no hay un
// formato fijo que respetar, es una tabla plana para exportar y filtrar en
// Excel.
import * as XLSX from 'xlsx-js-style'
import type { StockRow } from '@/lib/inventario/types'
import type { FilaMaterialOtt } from '@/lib/inventario/inventarioRepo'
import { compareSku } from '@/lib/inventario/sku'
import { LOTE_FISICO_FERRETERIA } from '@/lib/inventario/esFerreteria'

export type NaturalezaExport = 'fisico' | 'digital' | 'ambos'

const BORDER = {
  top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
  bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
  left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
  right:  { style: 'thin', color: { rgb: 'BFBFBF' } },
}

function cellStyle(isHeader: boolean, rowIdx: number, numeric: boolean) {
  const bandaRgb = isHeader ? '1F4E79' : rowIdx % 2 !== 0 ? 'FFFFFF' : 'EBF3FB'
  return {
    fill:      { patternType: 'solid' as const, fgColor: { rgb: bandaRgb } },
    font:      isHeader
      ? { name: 'Calibri', bold: true, sz: 11, color: { rgb: 'FFFFFF' } }
      : { name: 'Calibri', sz: 10 },
    alignment: isHeader
      ? { horizontal: 'center' as const, vertical: 'center' as const, wrapText: true }
      : { horizontal: numeric ? ('right' as const) : ('left' as const), vertical: 'center' as const },
    border: BORDER,
  }
}

function slugify(s: string): string {
  return s.replace(/\s+/g, '_').replace(/[^\w._-]/g, '') || 'todas'
}

/** Placeholder de material al que todavía no se le asignó un lote (no es un lote real). */
const LOTE_SIN_DEFINIR = 'SinDefinir'

/**
 * Qué filas de `stock` entran al Excel según la naturaleza:
 * - **Nunca lotes vacíos**: se descartan las filas sin cantidad en lo que se exporta
 *   (`adjust_stock` no borra la fila cuando queda en 0, así que quedan restos de
 *   todo lo que alguna vez pasó por la bodega).
 * - **Digital**: solo lotes reales de SAP — 'SinDefinir' (placeholder) y 'Físico'
 *   (lote que solo junta lo que hay físicamente en la bodega) no son un lote de
 *   SAP y no se muestran. Es la vista que se compara contra SAP.
 * Devuelve también cuánto digital quedó fuera por ser de esos lotes, para avisarlo.
 */
export function filtrarFilasExport(rows: StockRow[], naturaleza: NaturalezaExport): {
  filas: StockRow[]; omitidasSinLote: { filas: number; unidades: number }
} {
  const omitidasSinLote = { filas: 0, unidades: 0 }
  const filas = rows.filter((r) => {
    const tieneFisico = r.cantidadFisico !== 0
    const tieneDigital = r.cantidadDigital !== 0
    if (naturaleza === 'fisico') return tieneFisico
    const loteNoSap = r.lote === LOTE_SIN_DEFINIR || r.lote === LOTE_FISICO_FERRETERIA
    if (naturaleza === 'digital') {
      if (!tieneDigital) return false
      if (loteNoSap) { omitidasSinLote.filas += 1; omitidasSinLote.unidades += Math.abs(r.cantidadDigital); return false }
      return true
    }
    return tieneFisico || tieneDigital
  })
  return { filas, omitidasSinLote }
}

/**
 * Arma y descarga el Excel. `rows` ya viene filtrado a las bodegas elegidas
 * (ver ExportarStockExcelModal) — acá solo se decide qué columnas mostrar
 * según `naturaleza` y se ordena igual que la tabla de Stock > Bodega
 * (Bodega, luego SKU, luego Lote).
 */
export function generarStockExcel(
  rowsTodas: StockRow[], naturaleza: NaturalezaExport, bodegasLabel: string, materialOtts?: FilaMaterialOtt[],
): { filas: number; omitidasSinLote: { filas: number; unidades: number }; filasOtt: number } {
  const { filas: rows, omitidasSinLote } = filtrarFilasExport(rowsTodas, naturaleza)
  const incluyeFisico = naturaleza === 'fisico' || naturaleza === 'ambos'
  const incluyeDigital = naturaleza === 'digital' || naturaleza === 'ambos'

  const headers = ['SKU', 'Descripción', 'Bodega', 'Lote']
  if (incluyeFisico) headers.push('Físico')
  if (incluyeDigital) headers.push('Digital')
  const numericCols = new Set(headers.map((h, i) => (h === 'Físico' || h === 'Digital' ? i : -1)).filter((i) => i >= 0))

  const sorted = [...rows].sort((a, b) =>
    a.ubicacionNombre.localeCompare(b.ubicacionNombre)
    || compareSku(a.materialSku, b.materialSku, 'asc')
    || a.lote.localeCompare(b.lote))

  const dataRows: (string | number)[][] = sorted.map((r) => {
    const row: (string | number)[] = [r.materialSku, r.materialDescripcion, r.ubicacionNombre, r.lote]
    if (incluyeFisico) row.push(r.cantidadFisico)
    if (incluyeDigital) row.push(r.cantidadDigital)
    return row
  })

  const aoa = [headers, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      ws[addr].s = cellStyle(r === 0, r, numericCols.has(c))
    }
  }

  const colWidths = [14, 46, 18, 16, 10, 10].slice(0, headers.length)
  ws['!cols'] = colWidths.map((w) => ({ wch: w }))
  ws['!rows'] = aoa.map((_, i) => ({ hpt: i === 0 ? 26 : 18 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Stock')

  // Hoja aparte: material en tránsito e instalado de las OTT abiertas.
  if (materialOtts) agregarHojaOtt(wb, materialOtts)

  const naturalezaLabel = naturaleza === 'fisico' ? 'Fisico' : naturaleza === 'digital' ? 'Digital' : 'FisicoDigital'
  const fecha = new Date().toISOString().slice(0, 10)
  const fileName = `Stock_${naturalezaLabel}_${slugify(bodegasLabel)}_${fecha}.xlsx`
  XLSX.writeFile(wb, fileName)
  return { filas: rows.length, omitidasSinLote, filasOtt: materialOtts?.length ?? 0 }
}

/**
 * Pestaña "Tránsito e instalado OTT": una fila por OTT abierta + material + lote
 * con su bodega de origen. Lote vacío = sin lote (SinDefinir); Ferretería dice
 * "Físico". Los insumos no entran (solo se entregan).
 */
function agregarHojaOtt(wb: XLSX.WorkBook, filas: FilaMaterialOtt[]): void {
  const headers = ['Área', 'OTT', 'Dirección', 'SKU', 'Descripción', 'Bodega origen', 'Lote',
    'Entregado', 'Instalado', 'Devuelto', 'Merma', 'Asignado a técnico', 'En tránsito']
  const numericas = new Set([7, 8, 9, 10, 11, 12])
  const dataRows: (string | number)[][] = filas.map((f) => [
    f.area, f.ott, f.direccion, f.sku, f.descripcion, f.bodegaOrigen, f.lote,
    f.entregado, f.instalado, f.devuelto, f.merma, f.asignadoATecnico, f.transito,
  ])
  const aoa = [headers, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      ws[addr].s = cellStyle(r === 0, r, numericas.has(c))
    }
  }
  ws['!cols'] = [11, 16, 30, 14, 40, 14, 14, 10, 10, 10, 9, 12, 11].map((w) => ({ wch: w }))
  ws['!rows'] = aoa.map((_, i) => ({ hpt: i === 0 ? 30 : 18 }))
  XLSX.utils.book_append_sheet(wb, ws, 'Tránsito e instalado OTT')
}
