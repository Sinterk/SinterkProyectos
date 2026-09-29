// PDF imprimible de la pestaña Logística — pensado para que el técnico salga
// con él en papel (junto al plano, que ya sale impreso) y lo firme: una vez
// al retirar el material, otra vez al cerrar/instalar. Sin fotos ni datos
// pesados a propósito — es un formulario para escribir a mano y volver a
// cargar al sitio después, no un informe.
//
// type-only → TypeScript lo elimina en el build; jsPDF se carga en tiempo de
// ejecución (mismo patrón que generarPdfAtt.ts).
import type jsPDF from 'jspdf'

export interface HojaLogisticaMaterial {
  sku: string
  descripcion: string
  lote: string
  solicitado: number
  entregado: number
  instalado: number
  devuelto: number
  merma: number
}

export interface HojaLogisticaInput {
  /** Ej. "OTT 72603688266" / "Vitacura — 2" / "Incidencia INC-004". */
  titulo: string
  datosGenerales: { label: string; value: string }[]
  /** Nombres de los técnicos ya asignados — se reservan como mínimo 3 filas/firmas aunque haya menos. */
  tecnicos: string[]
  material: HojaLogisticaMaterial[]
  /** Observaciones ya registradas en el sitio, como texto ya formateado (autor/fecha incluidos). */
  observaciones: string[]
}

// ── Layout (pt, 72pt = 1 inch, letter 612×792) ────────────────────────────────
const PW = 612, PH = 792
const ML = 54, MR = 54
const CW = PW - ML - MR
const TOP = 40
const CONT_B = PH - 44

type RGB = [number, number, number]
const BLUE:  RGB = [0, 112, 192]
const BLACK: RGB = [0, 0, 0]
const GREY_TXT: RGB = [110, 110, 110]
const GREY_FILL: RGB = [235, 238, 242]

function setFill(doc: jsPDF, rgb: RGB) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
function setDraw(doc: jsPDF, rgb: RGB) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }
function setTxt(doc: jsPDF, rgb: RGB) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }

function box(doc: jsPDF, x: number, y: number, w: number, h: number, fill?: RGB) {
  setDraw(doc, BLACK); doc.setLineWidth(0.4)
  if (fill) { setFill(doc, fill); doc.rect(x, y, w, h, 'FD') }
  else doc.rect(x, y, w, h, 'S')
}

function newPage(doc: jsPDF): number {
  doc.addPage()
  return TOP
}
/** Si lo que sigue (altura `need`) no cabe antes de CONT_B, salta de página. */
function chk(doc: jsPDF, y: number, need: number): number {
  return y + need > CONT_B ? newPage(doc) : y
}

function heading(doc: jsPDF, text: string, y: number): number {
  y = chk(doc, y, 24)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, BLUE)
  doc.text(text.toUpperCase(), ML, y + 10)
  setDraw(doc, BLUE); doc.setLineWidth(0.6)
  doc.line(ML, y + 14, PW - MR, y + 14)
  setTxt(doc, BLACK)
  return y + 26
}

function stampFooter(doc: jsPDF, titulo: string) {
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setTxt(doc, GREY_TXT)
    doc.text(`Hoja de logística — ${titulo}`, ML, PH - 22)
    doc.text(`Página ${p} de ${total}`, PW - MR, PH - 22, { align: 'right' })
  }
}

// ── Tabla genérica de material (encabezado + filas + filas en blanco) ────────
interface Col { label: string; w: number; align?: 'left' | 'center' | 'right' }
const MATERIAL_COLS: Col[] = [
  { label: 'SKU', w: 50 },
  { label: 'Descripción', w: 166 },
  { label: 'Lote', w: 60 },
  { label: 'Solicit.', w: 38, align: 'right' },
  { label: 'Entreg.', w: 38, align: 'right' },
  { label: 'Instal.', w: 38, align: 'right' },
  { label: 'Devuelto', w: 42, align: 'right' },
  { label: 'Merma', w: 42, align: 'right' },
]
const ROW_H = 18

function tableRow(doc: jsPDF, y: number, values: string[], opts?: { header?: boolean }) {
  let x = ML
  for (let i = 0; i < MATERIAL_COLS.length; i++) {
    const col = MATERIAL_COLS[i]
    box(doc, x, y, col.w, ROW_H, opts?.header ? GREY_FILL : undefined)
    doc.setFont('helvetica', opts?.header ? 'bold' : 'normal'); doc.setFontSize(8)
    setTxt(doc, BLACK)
    const pad = 4
    let txt = values[i] ?? ''
    if (i === 1 && txt) { // Descripción: recorta a una línea si no cabe
      txt = doc.splitTextToSize(txt, col.w - pad * 2)[0] ?? ''
    }
    const align = col.align ?? 'left'
    if (align === 'right') doc.text(txt, x + col.w - pad, y + ROW_H / 2 + 3, { align: 'right' })
    else if (align === 'center') doc.text(txt, x + col.w / 2, y + ROW_H / 2 + 3, { align: 'center' })
    else doc.text(txt, x + pad, y + ROW_H / 2 + 3)
    x += col.w
  }
}

// ── Bloque de firmas (3 columnas: salida o instalado) ────────────────────────
function firmaBlock(doc: jsPDF, y: number, titulo: string, tecnicos: string[]): number {
  const H = 92
  y = heading(doc, titulo, y)
  y = chk(doc, y, H)
  const gap = 10
  const colW = (CW - gap * 2) / 3
  for (let i = 0; i < 3; i++) {
    const x = ML + i * (colW + gap)
    box(doc, x, y, colW, H)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setTxt(doc, BLACK)
    doc.text('Nombre:', x + 6, y + 14)
    doc.setFont('helvetica', 'bold')
    doc.text(tecnicos[i] ?? '', x + 6 + doc.getTextWidth('Nombre: '), y + 14, { maxWidth: colW - 16 - doc.getTextWidth('Nombre: ') })
    setDraw(doc, BLACK); doc.setLineWidth(0.4)
    doc.line(x + 6, y + H - 30, x + colW - 6, y + H - 30)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setTxt(doc, GREY_TXT)
    doc.text('Firma', x + colW / 2, y + H - 20, { align: 'center' })
    setTxt(doc, BLACK); doc.setFontSize(8)
    doc.text('Fecha:', x + 6, y + H - 6)
  }
  return y + H + 14
}

// ── Core ──────────────────────────────────────────────────────────────────────
export async function generarHojaLogistica(input: HojaLogisticaInput): Promise<void> {
  const { default: JsPDF } = await import('jspdf')
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })

  let y = TOP
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setTxt(doc, BLACK)
  doc.text('Hoja de logística de materiales', ML, y)
  y += 20
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12)
  doc.text(input.titulo, ML, y)
  y += 22

  // ── Datos generales ─────────────────────────────────────────────────────────
  y = heading(doc, 'Datos generales', y)
  const colW = CW / 2
  for (let i = 0; i < input.datosGenerales.length; i += 2) {
    y = chk(doc, y, 16)
    const par = input.datosGenerales.slice(i, i + 2)
    par.forEach((d, idx) => {
      const x = ML + idx * colW
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setTxt(doc, BLACK)
      const lbl = `${d.label}: `
      doc.text(lbl, x, y)
      doc.setFont('helvetica', 'normal')
      doc.text(d.value || '—', x + doc.getTextWidth(lbl), y, { maxWidth: colW - doc.getTextWidth(lbl) - 10 })
    })
    y += 16
  }
  y += 10

  // ── Técnicos asignados (mínimo 3 filas, aunque haya menos asignados) ─────────
  y = heading(doc, 'Técnicos asignados', y)
  const slots = Math.max(3, input.tecnicos.length)
  const tecRowH = 20
  y = chk(doc, y, tecRowH * slots)
  for (let i = 0; i < slots; i++) {
    box(doc, ML, y, CW, tecRowH)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setTxt(doc, BLACK)
    doc.text(input.tecnicos[i] ?? '', ML + 8, y + tecRowH / 2 + 3)
    y += tecRowH
  }
  y += 10

  // ── Material (filas reales + filas en blanco para agregar a mano) ───────────
  y = heading(doc, 'Material', y)
  y = chk(doc, y, ROW_H)
  tableRow(doc, y, MATERIAL_COLS.map((c) => c.label), { header: true })
  y += ROW_H

  for (const m of input.material) {
    y = chk(doc, y, ROW_H)
    tableRow(doc, y, [
      m.sku, m.descripcion, m.lote,
      String(m.solicitado || ''), String(m.entregado || ''), String(m.instalado || ''),
      String(m.devuelto || ''), String(m.merma || ''),
    ])
    y += ROW_H
  }
  const FILAS_VACIAS = 8
  for (let i = 0; i < FILAS_VACIAS; i++) {
    y = chk(doc, y, ROW_H)
    tableRow(doc, y, [])
    y += ROW_H
  }
  y += 10

  // ── Observaciones (las ya registradas + espacio en blanco) ──────────────────
  y = heading(doc, 'Observaciones', y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setTxt(doc, BLACK)
  for (const obs of input.observaciones) {
    const lines = doc.splitTextToSize(`• ${obs}`, CW)
    y = chk(doc, y, lines.length * 12 + 2)
    doc.text(lines, ML, y + 9)
    y += lines.length * 12 + 2
  }
  const LINEAS_VACIAS = 5
  for (let i = 0; i < LINEAS_VACIAS; i++) {
    y = chk(doc, y, 18)
    setDraw(doc, BLACK); doc.setLineWidth(0.3)
    doc.line(ML, y + 14, PW - MR, y + 14)
    y += 18
  }
  y += 6

  // ── Firmas: salida (entrega) e instalado (cierre) ────────────────────────────
  y = firmaBlock(doc, y, 'Firma de salida — retiro de materiales', input.tecnicos)
  y = firmaBlock(doc, y, 'Firma de instalado / cierre — devolución y consumo', input.tecnicos)

  stampFooter(doc, input.titulo)

  const fileName = `Hoja logistica - ${input.titulo}.pdf`.replace(/[\\/:*?"<>|]/g, '')
  doc.save(fileName)
}
