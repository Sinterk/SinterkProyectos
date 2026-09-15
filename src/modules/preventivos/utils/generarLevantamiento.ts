import * as XLSX from 'xlsx-js-style'
import type { Preventivo } from '../types'
import type { Brigada } from '@/lib/correccionesRepo'

const HEADERS = ['Pto', 'Descripción', 'Semestre', 'Cant', 'Tapa', 'Comuna', 'Cuadrante', 'Brigada']
const COL_WIDTHS = [10, 50, 12, 7, 7, 18, 12, 10]
const BRIGADA_COL = HEADERS.length - 1

// Columnas que van centradas (índice 0-based)
const CENTER_COLS = new Set([0, 2, 3, 4, 6, BRIGADA_COL])

const BORDER = {
  top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
  bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
  left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
  right:  { style: 'thin', color: { rgb: 'BFBFBF' } },
}

/**
 * Amarillo para lo pendiente de la brigada de Línea, verde fosforescente
 * para lo pendiente de OyM — pedido explícito de Andrés para distinguir a
 * simple vista quién tiene que reparar cada hallazgo. Se destaca la FILA
 * ENTERA (no solo la celda de Brigada) para que se note de un vistazo; solo
 * lo PENDIENTE (hallazgo sin marcar "resuelto") lleva color — uno ya
 * resuelto o un punto sin hallazgo usa el color de banda normal de la fila.
 */
const BRIGADA_FILL: Record<Brigada, string> = { linea: 'FFFF00', oym: '39FF14' }

function cellStyle(col: number, rowIdx: number, brigadaPendiente?: Brigada) {
  const isHeader = rowIdx === 0
  // idx=1 (impar) → blanco; idx=2 (par) → azul claro — igual que el script Python
  const bandaRgb = isHeader ? '1F4E79' : rowIdx % 2 !== 0 ? 'FFFFFF' : 'EBF3FB'
  const bgRgb = !isHeader && brigadaPendiente ? BRIGADA_FILL[brigadaPendiente] : bandaRgb

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

  const BRIGADA_LABELS: Record<Brigada, string> = { linea: 'Línea', oym: 'OyM' }
  // Pendiente = tiene brigada asignada y todavía no se marca "resuelto" — un
  // hallazgo ya resuelto o un punto sin hallazgo no lleva color ni etiqueta.
  const brigadaPendientePorFila: (Brigada | undefined)[] = []

  for (const p of puntos) {
    const desc = [p.descripcion, p.direccion].filter(Boolean).join(', ')
    const brigada = (p.brigada === 'linea' || p.brigada === 'oym') ? p.brigada : undefined
    const pendiente = brigada && p.hallazgo && !p.resuelto ? brigada : undefined
    brigadaPendientePorFila.push(pendiente)
    rows.push([
      p.nombre  || '',
      desc,
      semestre,
      '',        // Cant — depende de tipo de hallazgo (pendiente)
      '',        // Tapa — depende de tipo de hallazgo (pendiente)
      comuna,
      cuad,
      brigada ? BRIGADA_LABELS[brigada] : '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Aplicar estilos celda por celda
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < HEADERS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      ws[addr].s = cellStyle(c, r, r > 0 ? brigadaPendientePorFila[r - 1] : undefined)
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
