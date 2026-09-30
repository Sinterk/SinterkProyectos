// PDF imprimible de la pestaña Logística — pensado para que el técnico salga
// con él en papel (junto al plano, que ya sale impreso) y lo firme: una vez
// al retirar el material, otra vez al cerrar/instalar. Sin fotos ni datos
// pesados a propósito — es un formulario para escribir a mano y volver a
// cargar al sitio después, no un informe. Diseño pensado para caber en 1
// sola hoja (pedido explícito de Andrés, ver v2.15 en docs/CONTINUAR-BACKEND.md).
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
  /** Ej. "OTT 72603688266" / "Vitacura — 2" / "Incidencia INC-004". Solo para el pie de página y el nombre del archivo — ya no se imprime como subtítulo grande. */
  titulo: string
  datosGenerales: { label: string; value: string }[]
  /**
   * Fechas para la esquina superior derecha (1 o 2 — ATT pasa inicio/término,
   * Preventivos/Incidencias solo una). Si `value` viene vacío, se imprime
   * SOLO la etiqueta, sin "—" ni nada — así se puede completar a lápiz en
   * terreno en vez de tachar un guion.
   */
  fechas: { label: string; value: string }[]
  tecnicos: string[]
  material: HojaLogisticaMaterial[]
  /** Observaciones ya registradas en el sitio, como texto ya formateado (autor/fecha incluidos). */
  observaciones: string[]
}

// ── Layout (pt, 72pt = 1 inch, letter 612×792) ────────────────────────────────
const PW = 612, PH = 792
const ML = 54, MR = 54
const CW = PW - ML - MR
const TOP = 34
const CONT_B = PH - 36

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
  y = chk(doc, y, 22)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); setTxt(doc, BLUE)
  doc.text(text.toUpperCase(), ML, y + 9)
  setDraw(doc, BLUE); doc.setLineWidth(0.6)
  doc.line(ML, y + 12, PW - MR, y + 12)
  setTxt(doc, BLACK)
  return y + 22
}

function stampFooter(doc: jsPDF, titulo: string) {
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setTxt(doc, GREY_TXT)
    doc.text(`Asignación de materiales — ${titulo}`, ML, PH - 20)
    doc.text(`Página ${p} de ${total}`, PW - MR, PH - 20, { align: 'right' })
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
const ROW_H = 16

function tableRowGeneric(doc: jsPDF, x0: number, y: number, h: number, cols: Col[], values: string[], opts?: { header?: boolean }) {
  let x = x0
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]
    box(doc, x, y, col.w, h, opts?.header ? GREY_FILL : undefined)
    doc.setFont('helvetica', opts?.header ? 'bold' : 'normal'); doc.setFontSize(8)
    setTxt(doc, BLACK)
    const pad = 4
    let txt = values[i] ?? ''
    if (txt) txt = doc.splitTextToSize(txt, col.w - pad * 2)[0] ?? ''
    const align = col.align ?? 'left'
    if (align === 'right') doc.text(txt, x + col.w - pad, y + h / 2 + 3, { align: 'right' })
    else if (align === 'center') doc.text(txt, x + col.w / 2, y + h / 2 + 3, { align: 'center' })
    else doc.text(txt, x + pad, y + h / 2 + 3)
    x += col.w
  }
}

// ── Firmas: UNA sola tabla, una fila por técnico, salida e instalado lado a lado ──
// Pedido explícito: "solo dejemos una línea para 1 técnico, de salida e
// instalación, para ahorrar espacio" — antes eran 2 bloques de 3 cajas cada
// uno (~200pt); esto es 1 tabla compacta, ~20pt por técnico.
const FIRMA_COLS: Col[] = [
  { label: 'Técnico', w: 150 },
  { label: 'Firma salida', w: 106, align: 'center' },
  { label: 'Fecha', w: 62, align: 'center' },
  { label: 'Firma instalado', w: 124, align: 'center' },
  { label: 'Fecha', w: 62, align: 'center' },
]
const FIRMA_ROW_H = 26

function firmaTabla(doc: jsPDF, y: number, tecnicos: string[]): number {
  y = heading(doc, 'Firmas — salida e instalado', y)
  y = chk(doc, y, ROW_H)
  tableRowGeneric(doc, ML, y, ROW_H, FIRMA_COLS, FIRMA_COLS.map((c) => c.label), { header: true })
  y += ROW_H
  const filas = tecnicos.length > 0 ? tecnicos : ['']
  for (const nombre of filas) {
    y = chk(doc, y, FIRMA_ROW_H)
    tableRowGeneric(doc, ML, y, FIRMA_ROW_H, FIRMA_COLS, [nombre])
    y += FIRMA_ROW_H
  }
  return y + 8
}

// ── Core ──────────────────────────────────────────────────────────────────────
export async function generarHojaLogistica(input: HojaLogisticaInput): Promise<void> {
  const { default: JsPDF } = await import('jspdf')
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })

  let y = TOP
  // Título — sin subtítulo (la identificación del proyecto ya va en Datos
  // generales, no hace falta repetirla acá). Las fechas van a la derecha,
  // en la misma línea, para no gastar una fila aparte.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setTxt(doc, BLACK)
  doc.text('Asignación de materiales', ML, y + 12)

  if (input.fechas.length > 0) {
    const fx = PW - MR
    let fy = y
    doc.setFontSize(8.5)
    for (const f of input.fechas) {
      doc.setFont('helvetica', 'bold'); setTxt(doc, BLACK)
      const lbl = `${f.label}: `
      const lblW = doc.getTextWidth(lbl)
      doc.setFont('helvetica', 'normal')
      const valW = f.value ? doc.getTextWidth(f.value) : 0
      doc.text(lbl, fx - lblW - valW, fy)
      if (f.value) doc.text(f.value, fx - valW, fy)
      fy += 12
    }
  }
  y += 26

  // ── Datos generales ─────────────────────────────────────────────────────────
  y = heading(doc, 'Datos generales', y)
  const colW = CW / 2
  for (let i = 0; i < input.datosGenerales.length; i += 2) {
    y = chk(doc, y, 15)
    const par = input.datosGenerales.slice(i, i + 2)
    par.forEach((d, idx) => {
      const x = ML + idx * colW
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setTxt(doc, BLACK)
      const lbl = `${d.label}: `
      doc.text(lbl, x, y)
      doc.setFont('helvetica', 'normal')
      // Sin valor, no se imprime "—": mismo criterio que las fechas, para
      // poder completar a mano en vez de tachar un guion (ver v2.15/v2.18).
      if (d.value) doc.text(d.value, x + doc.getTextWidth(lbl), y, { maxWidth: colW - doc.getTextWidth(lbl) - 10 })
    })
    y += 15
  }
  y += 6

  // ── Técnicos asignados (mínimo 3 filas, aunque haya menos asignados) ─────────
  y = heading(doc, 'Técnicos asignados', y)
  const slots = Math.max(3, input.tecnicos.length)
  const tecRowH = 17
  y = chk(doc, y, tecRowH * slots)
  for (let i = 0; i < slots; i++) {
    box(doc, ML, y, CW, tecRowH)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setTxt(doc, BLACK)
    doc.text(input.tecnicos[i] ?? '', ML + 8, y + tecRowH / 2 + 3)
    y += tecRowH
  }
  y += 6

  // ── Material (filas reales + filas en blanco para agregar a mano) ───────────
  y = heading(doc, 'Material', y)
  y = chk(doc, y, ROW_H)
  tableRowGeneric(doc, ML, y, ROW_H, MATERIAL_COLS, MATERIAL_COLS.map((c) => c.label), { header: true })
  y += ROW_H

  for (const m of input.material) {
    y = chk(doc, y, ROW_H)
    tableRowGeneric(doc, ML, y, ROW_H, MATERIAL_COLS, [
      m.sku, m.descripcion, m.lote,
      String(m.solicitado || ''), String(m.entregado || ''), String(m.instalado || ''),
      String(m.devuelto || ''), String(m.merma || ''),
    ])
    y += ROW_H
  }
  const FILAS_VACIAS = 6
  for (let i = 0; i < FILAS_VACIAS; i++) {
    y = chk(doc, y, ROW_H)
    tableRowGeneric(doc, ML, y, ROW_H, MATERIAL_COLS, [])
    y += ROW_H
  }
  y += 6

  // ── Observaciones (las ya registradas + espacio en blanco) ──────────────────
  y = heading(doc, 'Observaciones', y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setTxt(doc, BLACK)
  for (const obs of input.observaciones) {
    const lines = doc.splitTextToSize(`• ${obs}`, CW)
    y = chk(doc, y, lines.length * 12 + 2)
    doc.text(lines, ML, y + 9)
    y += lines.length * 12 + 2
  }
  const LINEAS_VACIAS = 4
  for (let i = 0; i < LINEAS_VACIAS; i++) {
    y = chk(doc, y, 16)
    setDraw(doc, BLACK); doc.setLineWidth(0.3)
    doc.line(ML, y + 13, PW - MR, y + 13)
    y += 16
  }
  y += 4

  // ── Firmas ────────────────────────────────────────────────────────────────────
  y = firmaTabla(doc, y, input.tecnicos)

  stampFooter(doc, input.titulo)

  const fileName = `Asignacion de materiales - ${input.titulo}.pdf`.replace(/[\\/:*?"<>|]/g, '')
  doc.save(fileName)
}

/**
 * Versión en blanco, sin ligar a ninguna OTT — para tener a mano e imprimir
 * de antemano, sin depender de generarla desde una OTT específica ya
 * guardada (pedido de Andrés: descargable desde la ventana de ATT, junto al
 * botón de Calendario). Mismo formato que la de una OTT real: 3 líneas para
 * escribir los técnicos a mano (`tecnicos: ['', '', '']` ya le basta a
 * `firmaTabla`/Técnicos asignados para reservar 3 filas en blanco, sin
 * necesidad de tocar esa lógica).
 */
export async function generarHojaLogisticaGenerica(): Promise<void> {
  await generarHojaLogistica({
    titulo: 'genérico',
    datosGenerales: [
      { label: 'OTT', value: '' },
      { label: 'Dirección', value: '' },
    ],
    fechas: [
      { label: 'Fecha de inicio', value: '' },
      { label: 'Fecha de término', value: '' },
    ],
    tecnicos: ['', '', ''],
    material: [],
    observaciones: [],
  })
}
