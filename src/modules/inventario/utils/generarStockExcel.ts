// Excel de stock (Físico/Digital) por bodega — mismo patrón que
// generarLevantamiento.ts (xlsx-js-style, hoja simple AOA + estilo celda por
// celda), no el patrón de plantilla de generarInformeEntel.ts: acá no hay un
// formato fijo que respetar, es una tabla plana para exportar y filtrar en
// Excel.
import * as XLSX from 'xlsx-js-style'
import type { StockRow } from '@/lib/inventario/types'
import { compareSku } from '@/lib/inventario/sku'

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

/**
 * Arma y descarga el Excel. `rows` ya viene filtrado a las bodegas elegidas
 * (ver ExportarStockExcelModal) — acá solo se decide qué columnas mostrar
 * según `naturaleza` y se ordena igual que la tabla de Stock > Bodega
 * (Bodega, luego SKU, luego Lote).
 */
export function generarStockExcel(rows: StockRow[], naturaleza: NaturalezaExport, bodegasLabel: string): void {
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

  const naturalezaLabel = naturaleza === 'fisico' ? 'Fisico' : naturaleza === 'digital' ? 'Digital' : 'FisicoDigital'
  const fecha = new Date().toISOString().slice(0, 10)
  const fileName = `Stock_${naturalezaLabel}_${slugify(bodegasLabel)}_${fecha}.xlsx`
  XLSX.writeFile(wb, fileName)
}
