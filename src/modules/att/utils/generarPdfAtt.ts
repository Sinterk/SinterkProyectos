// type-only → TypeScript lo elimina en el build; jsPDF se carga en tiempo de ejecución
import type jsPDF from 'jspdf'
import { ATT_LOGO_B64 } from './logoBase64'
import { TIPO_PROYECTO_LABELS } from '../types'
import type { AttRecord, FotoEntry } from '../types'

// ── Layout (pt, 72pt = 1 inch, letter 612×792) ────────────────────────────────
const PW = 612, PH = 792
const ML = 72, MR = 72
const CW = PW - ML - MR                   // 468pt content width
const HDR_Y  = 32
const HDR_R1 = 32, HDR_R2 = 24
const HDR_H  = HDR_R1 + HDR_R2            // 56pt total header
const CONT_Y = HDR_Y + HDR_H + 12         // ≈ 100pt
const CONT_B = PH - 38                    // ≈ 754pt

// ── Colors ────────────────────────────────────────────────────────────────────
type RGB = [number, number, number]
const BLUE:  RGB = [0,  112, 192]
const DBLUE: RGB = [0,  78,  140]
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0,   0,   0]
const SBLU:  RGB = [79, 129, 189]

// ── Canvas compression targets (px) ───────────────────────────────────────────
// jsPDF embeds JPEG bytes directly — no re-encoding. Smaller canvas = smaller PDF.
const PORT_PX = { w: 280, h: 374 }   // ~15-25 KB/foto
const LAND_PX = { w: 560, h: 374 }   // ~25-40 KB/foto landscape
const AERO_PX = { w: 500, h: 334 }
const JPEG_Q  = 0.62

// ── Helpers ───────────────────────────────────────────────────────────────────
const MESES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre',
]

function fechaDesdeISO(iso?: string): string {
  if (!iso) {
    const d = new Date()
    return `${d.getDate().toString().padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`
  }
  const [y, m, d] = iso.split('-').map(Number)
  return `${d.toString().padStart(2,'0')} ${MESES[m-1]} ${y}`
}

const CAT_LABELS: Record<string, string> = {
  tendidoFO: 'TENDIDO FO', cmic: 'CMIC', medicionTraza: 'MEDICIÓN TRAZA',
  reparacionDucto: 'REPARACIÓN DE DUCTO', mufaProyectada: 'MUFA PROYECTADA',
  ingresoRed: 'INGRESO A RED',
}

function fotoLabel(f: FotoEntry): string {
  return f.categoria === 'otro'
    ? (f.otroLabel?.trim() || 'OTRO').toUpperCase()
    : (CAT_LABELS[f.categoria] ?? f.categoria.toUpperCase())
}

function isLand(f: FotoEntry) { return f.categoria === 'medicionTraza' }

// ── Image compression ─────────────────────────────────────────────────────────
interface CImg { src: string; iw: number; ih: number }

async function compressImg(url: string, maxW: number, maxH: number, q: number): Promise<CImg | null> {
  if (!url) return null
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      const s = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
      c.width  = Math.round(img.naturalWidth  * s)
      c.height = Math.round(img.naturalHeight * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      resolve({ src: c.toDataURL('image/jpeg', q), iw: c.width, ih: c.height })
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
function setFill(doc: jsPDF, rgb: RGB) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
function setDraw(doc: jsPDF, rgb: RGB) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }
function setTxt(doc:  jsPDF, rgb: RGB) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }

function filledBox(doc: jsPDF, x: number, y: number, w: number, h: number, fill: RGB) {
  setFill(doc, fill); setDraw(doc, BLACK); doc.setLineWidth(0.4)
  doc.rect(x, y, w, h, 'FD')
}

function strokedBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  setDraw(doc, BLACK); doc.setLineWidth(0.4)
  doc.rect(x, y, w, h, 'S')
}

// Renders lines of text centered both axes inside a cell box.
function cellText(
  doc: jsPDF, lines: string[],
  cx: number, cy: number, maxW: number,
  align: 'center' | 'left' = 'center',
) {
  if (!lines.length) return
  const fs  = doc.getFontSize()
  const lh  = fs * 1.18
  const blockH = lines.length * lh
  let startY = cy - blockH / 2 + lh * 0.78
  for (const line of lines) {
    doc.text(line, cx, startY, { align, maxWidth: maxW })
    startY += lh
  }
}

function placeImg(doc: jsPDF, ci: CImg, x: number, y: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / ci.iw, boxH / ci.ih)
  const dw = ci.iw * scale, dh = ci.ih * scale
  doc.addImage(ci.src, 'JPEG', x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh)
}

// ── Header ────────────────────────────────────────────────────────────────────
function drawHeader(doc: jsPDF, titulo: string, fecha: string, ott: string, csNombre: string) {
  const x = ML, y = HDR_Y
  const c1 = 66, c3 = 100, c2 = CW - c1 - c3   // 66 | 302 | 100

  // Thick outer border (simulates double line)
  setDraw(doc, BLACK); doc.setLineWidth(2)
  doc.rect(x, y, CW, HDR_H, 'S')

  // Internal dividers
  doc.setLineWidth(0.4)
  doc.line(x+c1,    y,        x+c1,    y+HDR_H)
  doc.line(x+c1+c2, y,        x+c1+c2, y+HDR_H)
  doc.line(x,       y+HDR_R1, x+CW,    y+HDR_R1)

  // Logo (row 1, col 1)
  try {
    doc.addImage(
      `data:image/jpeg;base64,${ATT_LOGO_B64}`, 'JPEG',
      x + 4, y + 4, c1 - 8, HDR_R1 - 8,
    )
  } catch (_) { /* logo load failure is non-fatal */ }

  // Title (row 1, col 2)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setTxt(doc, BLACK)
  const titleLines = doc.splitTextToSize(titulo, c2 - 8)
  cellText(doc, titleLines.slice(0, 2), x + c1 + c2 / 2, y + HDR_R1 / 2, c2 - 8)

  // Date (row 1, col 3)
  const dx = x + c1 + c2
  doc.setFontSize(8)
  doc.text('FECHA INFORME', dx + c3 / 2, y + 11, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.text(fecha, dx + c3 / 2, y + 23, { align: 'center' })

  // Row 2: OTT code
  const y2 = y + HDR_R1
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(ott, x + c1 / 2, y2 + HDR_R2 / 2, { align: 'center', baseline: 'middle' })

  // Row 2: CS name
  const csLines = doc.splitTextToSize(csNombre, c2 - 8)
  cellText(doc, csLines.slice(0, 2), x + c1 + c2 / 2, y2 + HDR_R2 / 2, c2 - 8)

  // Row 2: OTT label
  doc.setFont('helvetica', 'bold')
  doc.text(`OTT ${ott}`, dx + c3 / 2, y2 + HDR_R2 / 2, { align: 'center', baseline: 'middle' })
}

// ── Page management ───────────────────────────────────────────────────────────
type HdrArgs = [string, string, string, string]

function newPage(doc: jsPDF, ha: HdrArgs): number {
  doc.addPage()
  drawHeader(doc, ...ha)
  return CONT_Y
}

function chk(doc: jsPDF, y: number, need: number, ha: HdrArgs): number {
  return y + need > CONT_B ? newPage(doc, ha) : y
}

// ── Section heading ───────────────────────────────────────────────────────────
function heading(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); setTxt(doc, SBLU)
  doc.text(text, ML, y + 8)
  setTxt(doc, BLACK)
  return y + 18
}

// ── Section 1: Tipo de proyecto ───────────────────────────────────────────────
function drawTipo(doc: jsPDF, tipo: string, y: number): number {
  const GRID: [string, string][] = [
    ['acceso_fijo', 'backhaul'],
    ['conectividad_movil', 'acceso_b2b'],
    ['proyectos_acceso', 'modernizacion'],
    ['vulnerabilidad', 'adaptacion'],
  ]
  const rH = 22
  const c1 = Math.round(CW * 0.38), c2 = Math.round(CW * 0.12)

  for (const [l, r] of GRID) {
    const sL = tipo === l, sR = tipo === r
    const lblL = TIPO_PROYECTO_LABELS[l as keyof typeof TIPO_PROYECTO_LABELS] || l
    const lblR = TIPO_PROYECTO_LABELS[r as keyof typeof TIPO_PROYECTO_LABELS] || r

    filledBox(doc, ML,            y, c1, rH, sL ? DBLUE : BLUE)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setTxt(doc, WHITE)
    cellText(doc, doc.splitTextToSize(lblL, c1 - 6), ML + c1 / 2, y + rH / 2, c1 - 6)

    strokedBox(doc, ML + c1,      y, c2, rH)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setTxt(doc, BLACK)
    if (sL) doc.text('X', ML + c1 + c2 / 2, y + rH / 2, { align: 'center', baseline: 'middle' })

    filledBox(doc, ML + c1 + c2,  y, c1, rH, sR ? DBLUE : BLUE)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setTxt(doc, WHITE)
    cellText(doc, doc.splitTextToSize(lblR, c1 - 6), ML + c1 + c2 + c1 / 2, y + rH / 2, c1 - 6)

    strokedBox(doc, ML + c1*2+c2, y, c2, rH)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setTxt(doc, BLACK)
    if (sR) doc.text('X', ML + c1*2+c2 + c2 / 2, y + rH / 2, { align: 'center', baseline: 'middle' })

    y += rH
  }
  return y + 8
}

// ── Section 4: Infraestructura ─────────────────────────────────────────────────
function drawInfra(doc: jsPDF, infra: AttRecord['infraestructura'], y: number): number {
  const rH = 18
  const c1 = Math.round(CW * 0.55), c234 = Math.round(CW * 0.15)
  const xs = [ML, ML + c1, ML + c1 + c234, ML + c1 + c234 * 2]
  const ws = [c1, c234, c234, c234]

  // Header row
  const headers = ['Infraestructura', 'Sí / No', 'Cantidad', 'Compañía']
  headers.forEach((h, idx) => {
    filledBox(doc, xs[idx], y, ws[idx], rH, BLUE)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setTxt(doc, WHITE)
    cellText(doc, [h], xs[idx] + ws[idx] / 2, y + rH / 2, ws[idx] - 4)
  })
  y += rH

  const { postesElectricos: pe, postesOtraTeleco: pt, ductosOtraTeleco: dt,
          fibraOtraCompania: fo, postesEntel: pE } = infra
  const rows: [string, boolean, string, string][] = [
    ['¿Utiliza postes eléctricos?',                 pe.usa, pe.usa ? pe.cantidad : '', pe.usa ? pe.compania : ''],
    ['¿Utiliza postes de otra compañía de teleco?', pt.usa, pt.usa ? pt.cantidad : '', pt.usa ? pt.compania : ''],
    ['¿Utiliza ductos de otra compañía de teleco?', dt.usa, dt.usa ? dt.cantidad : '', dt.usa ? dt.compania : ''],
    ['¿Utiliza fibra óptica de otra compañía?',     fo.usa, '', ''],
    ['¿Se proyectan postes/ductos de Entel?',       pE.usa, '', ''],
  ]

  for (const [lbl, usa, cant, comp] of rows) {
    strokedBox(doc, xs[0], y, ws[0], rH)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setTxt(doc, BLACK)
    cellText(doc, doc.splitTextToSize(lbl, ws[0] - 8), xs[0] + 5, y + rH / 2, ws[0] - 8, 'left')

    const vals = [usa ? 'SI' : 'NO', cant, comp]
    for (let k = 1; k <= 3; k++) {
      strokedBox(doc, xs[k], y, ws[k], rH)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setTxt(doc, BLACK)
      cellText(doc, [vals[k-1] || ''], xs[k] + ws[k] / 2, y + rH / 2, ws[k] - 4)
    }
    y += rH
  }
  return y + 8
}

// ── Photo box ─────────────────────────────────────────────────────────────────
const LBL_H = 20   // label bar height (pt)
const IMG_H = 220  // photo area height (pt)
const ROW_H = LBL_H + IMG_H  // 240pt per photo row

function photoBox(doc: jsPDF, x: number, y: number, w: number, label: string, ci?: CImg | null) {
  strokedBox(doc, x, y, w, ROW_H)
  setDraw(doc, BLACK); doc.setLineWidth(0.4)
  doc.line(x, y + LBL_H, x + w, y + LBL_H)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setTxt(doc, BLACK)
  cellText(doc, doc.splitTextToSize(label, w - 6).slice(0, 2), x + w / 2, y + LBL_H / 2, w - 6)
  if (ci?.src) {
    try { placeImg(doc, ci, x + 3, y + LBL_H + 3, w - 6, IMG_H - 6) } catch (_) { /* image error non-fatal */ }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generarPdfAtt(record: AttRecord): Promise<void> {
  const fecha      = fechaDesdeISO(record.fecha)
  const ott        = record.ott || ''
  const titulo     = record.tituloInforme?.trim() || `Informe posterior OTT ${ott}`
  const cs         = record.codigoServicio ?? ''
  const csNombre   = [cs, record.nombreServicio].filter(Boolean).join(' ')
  const idProyecto = [ott, cs].filter(Boolean).join(' - ')

  // medicionTraza always after all other photos
  const fotos: FotoEntry[] = [
    ...record.fotos.filter(f => !isLand(f)),
    ...record.fotos.filter(f =>  isLand(f)),
  ]

  // Compress all images into canvas JPEGs — jsPDF embeds them as-is (no re-encode)
  const compMap = new Map<string, CImg>()
  await Promise.all([
    record.fotoAerea?.previewUrl
      ? compressImg(record.fotoAerea.previewUrl, AERO_PX.w, AERO_PX.h, JPEG_Q)
          .then(c => { if (c) compMap.set(record.fotoAerea!.previewUrl, c) })
      : Promise.resolve(),
    ...fotos.map(f => {
      if (!f.previewUrl) return Promise.resolve()
      const { w, h } = isLand(f) ? LAND_PX : PORT_PX
      return compressImg(f.previewUrl, w, h, JPEG_Q)
        .then(c => { if (c) compMap.set(f.previewUrl, c) })
    }),
  ])

  const ci = (url?: string): CImg | undefined => url ? compMap.get(url) : undefined
  const ha: HdrArgs = [titulo, fecha, ott, csNombre]

  const { default: JsPDF } = await import('jspdf')
  const doc = new JsPDF({ unit: 'pt', format: 'letter' })

  // ── Page 1: Sections 1, 2, 3 ─────────────────────────────────────────────────
  drawHeader(doc, ...ha)
  let y = CONT_Y

  // Section 1
  y = heading(doc, '1. TIPO DE PROYECTO', y)
  y += 4
  y = drawTipo(doc, record.tipoProyecto, y)

  // Section 2
  y = chk(doc, y, 150, ha)
  y = heading(doc, '2. DATOS DEL PROYECTO', y)
  y += 2

  const datos: [string, string][] = [
    ['Nombre del proyecto: ',          record.nombreProyecto],
    ['Iniciativa del proyecto: ',      record.iniciativa],
    ['ID de Proyecto: ',               idProyecto],
    ['Ingeniero Proyecto: ',           record.ingenieroProyecto],
    ['Jefe de Proyecto: ',             record.jefeProyecto],
    ['Comuna: ',                       record.comuna],
    ['Región: ',                       record.region],
    ['Contratista: ',                  record.contratista],
    ['Coordenadas inicio: Latitud ',   `${record.coordsInicio.lat} S   Longitud ${record.coordsInicio.lng} W`],
    ['Coordenadas término: Latitud ',  `${record.coordsTermino.lat} S   Longitud ${record.coordsTermino.lng} W`],
  ]
  for (const [label, val] of datos) {
    y = chk(doc, y, 14, ha)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setTxt(doc, BLACK)
    doc.text(label, ML, y)
    doc.setFont('helvetica', 'bold')
    doc.text(val || '', ML + doc.getTextWidth(label), y)
    y += 13
  }
  y += 6

  // Section 3
  y = chk(doc, y, 60, ha)
  y = heading(doc, '3. DESCRIPCIÓN GENERAL DEL PROYECTO', y)
  y += 2

  const validTramos = record.tramos.filter(t => t.tipoCable || t.metraje || t.desde || t.hasta)
  for (let ti = 0; ti < validTramos.length; ti++) {
    const t   = validTramos[ti]
    const end = ti === validTramos.length - 1 ? '.' : ';'
    const txt = `Se realiza tendido de ${t.metraje||'___'}m de cable ${t.tipoCable||'___'} desde ${t.desde||'___'} hasta ${t.hasta||'___'}${end}`
    const lines = doc.splitTextToSize(txt, CW)
    y = chk(doc, y, 12 * lines.length + 2, ha)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setTxt(doc, BLACK)
    doc.text(lines, ML, y)
    y += 12 * lines.length + 2
  }

  const descItems: string[] = []
  if (record.instalaCMIC)          descItems.push('Se instala CMIC en cliente;')
  if (record.instalaMufas)         descItems.push('Se instala mufa proyectada;')
  if (record.tieneReparacionDucto) descItems.push('Se realiza calicata y reparación de ducto;')
  if (record.tieneIngresoRed) {
    descItems.push('Con ingreso a red;')
    const { nodo, rack, odf, fo } = record.ingresoRed
    if (nodo) descItems.push(`    NODO    ${nodo}`)
    if (rack) descItems.push(`    RACK    ${rack}`)
    if (odf)  descItems.push(`    ODF     ${odf}`)
    if (fo)   descItems.push(`    FO      ${fo}`)
  }
  for (const item of descItems) {
    y = chk(doc, y, 14, ha)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setTxt(doc, BLACK)
    doc.text(item, ML, y)
    y += 13
  }
  for (const h of record.hitos) {
    const text = [h.fecha, h.descripcion].filter(Boolean).join(' — ')
    if (!text) continue
    y = chk(doc, y, 14, ha)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); setTxt(doc, BLACK)
    doc.text(`• ${text}`, ML + 12, y)
    y += 13
  }

  // ── Page 2: Aerial + Section 4 ───────────────────────────────────────────────
  y = newPage(doc, ha)

  const aereoImg = ci(record.fotoAerea?.previewUrl)
  if (aereoImg) {
    y = heading(doc, 'FOTO AÉREA', y)
    y += 4
    const aW = 300, aH = 200
    placeImg(doc, aereoImg, ML + (CW - aW) / 2, y, aW, aH)
    y += aH + 12
  }

  y = chk(doc, y, 140, ha)
  y = heading(doc, '4. INFRAESTRUCTURA PARA UTILIZAR', y)
  y += 4
  y = drawInfra(doc, record.infraestructura, y)

  // ── Pages 3+: Section 5 ───────────────────────────────────────────────────────
  y = newPage(doc, ha)
  y = heading(doc, '5. DETALLE DE SINGULARIDADES Y REGISTROS FOTOGRÁFICOS.', y)
  y += 6

  const PORT_W_D = (CW - 10) / 2   // portrait column width ≈ 229pt
  const LAND_W_D = CW               // landscape full width = 468pt

  for (let i = 0; i < fotos.length; ) {
    const f    = fotos[i]
    const land = isLand(f)

    // Page break check: need room for a row (+ gap if not first)
    if (i > 0) {
      const gap = 8
      if (y + gap + ROW_H > CONT_B) {
        y = newPage(doc, ha)
        y = heading(doc, '5. DETALLE DE SINGULARIDADES Y REGISTROS FOTOGRÁFICOS. (cont.)', y)
        y += 6
      } else {
        y += gap
      }
    }

    if (land) {
      photoBox(doc, ML, y, LAND_W_D, fotoLabel(f), ci(f.previewUrl))
      y += ROW_H; i++
    } else if (i + 1 < fotos.length && !isLand(fotos[i + 1])) {
      const f2 = fotos[i + 1]
      photoBox(doc, ML,              y, PORT_W_D, fotoLabel(f),  ci(f.previewUrl))
      photoBox(doc, ML+PORT_W_D+10,  y, PORT_W_D, fotoLabel(f2), ci(f2.previewUrl))
      y += ROW_H; i += 2
    } else {
      photoBox(doc, ML, y, PORT_W_D, fotoLabel(f), ci(f.previewUrl))
      y += ROW_H; i++
    }
  }

  // Direct download — no print dialog
  doc.save(`Informe OTT ${ott || 'sin-ott'}.pdf`)
}
