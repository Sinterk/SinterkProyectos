import * as XLSX from 'xlsx-js-style'
import type { Preventivo } from '../types'

const HEADERS = ['Pto', 'Descripción', 'Semestre', 'Cant', 'Tapa', 'Comuna', 'Cuadrante']
const COL_WIDTHS = [10, 50, 12, 7, 7, 18, 12]

// Columnas que van centradas (índice 0-based)
const CENTER_COLS = new Set([0, 2, 3, 4, 6])

const BORDER = {
  top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
  bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
  left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
  right:  { style: 'thin', color: { rgb: 'BFBFBF' } },
}

function cellStyle(col: number, rowIdx: number) {
  const isHeader = rowIdx === 0
  // idx=1 (impar) → blanco; idx=2 (par) → azul claro — igual que el script Python
  const bgRgb = isHeader ? '1F4E79' : rowIdx % 2 !== 0 ? 'FFFFFF' : 'EBF3FB'

  return {
    fill:      { patternType: 'solid', fgColor: { rgb: bgRgb } },
    font:      isHeader
      ? { name: 'Calibri', bold: true, sz: 11, color: { rgb: 'FFFFFF' } }
      : { name: 'Calibri', sz: 10 },
    alignment: isHeader
      ? { horizontal: 'center', vertical: 'center', wrapText: true }
      : CENTER_COLS.has(col)
        ? { horizontal: 'center', vertical: 'center' }
        : { horizontal: 'left',   vertical: 'center', wrapText: true },
    border: BORDER,
  }
}

function slugify(meta: Preventivo['cuadrante']): string {
  const s = meta.semestre || ''
  const c = (meta.comuna    || 'comuna').replace(/\s+/g, '_')
  const q = (meta.cuadrante || 'cuadrante').replace(/\s+/g, '_').slice(0, 25)
  return `${s}_${c}_${q}`.replace(/[^\w._-]/g, '') || 'salida'
}

// ── Core: arma el workbook sin descargarlo ────────────────────────────────────
function buildLevantamientoWorkbook(preventivo: Preventivo): { wb: XLSX.WorkBook; fileName: string } {
  const { cuadrante, puntos } = preventivo
  const semestre = cuadrante.semestre || ''
  const comuna   = cuadrante.comuna   || ''
  const cuad     = cuadrante.cuadrante || ''

  // Fila 0 = cabecera, filas 1..N = datos
  const rows: string[][] = [HEADERS]

  for (const p of puntos) {
    const desc = [p.descripcion, p.direccion].filter(Boolean).join(', ')
    rows.push([
      p.nombre  || '',
      desc,
      semestre,
      '',        // Cant — depende de tipo de hallazgo (pendiente)
      '',        // Tapa — depende de tipo de hallazgo (pendiente)
      comuna,
      cuad,
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Aplicar estilos celda por celda
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < HEADERS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      ws[addr].s = cellStyle(c, r)
    }
  }

  ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }))
  ws['!rows'] = rows.map((_, i) => ({ hpt: i === 0 ? 28 : 20 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Levantamiento')
  return { wb, fileName: `Levantamiento_${slugify(cuadrante)}.xlsx` }
}

// ── Wrapper: descarga directa (comportamiento histórico del botón) ───────────
export function generarLevantamiento(preventivo: Preventivo): void {
  const { wb, fileName } = buildLevantamientoWorkbook(preventivo)
  XLSX.writeFile(wb, fileName)
}

// ── Wrapper: devuelve el Blob sin descargar (para el ZIP masivo) ─────────────
export function generarLevantamientoBlob(preventivo: Preventivo): { blob: Blob; fileName: string } {
  const { wb, fileName } = buildLevantamientoWorkbook(preventivo)
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  return { blob, fileName }
}
