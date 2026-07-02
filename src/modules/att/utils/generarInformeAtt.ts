import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  SimpleField,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import { ATT_LOGO_B64 } from './logoBase64'
import { TIPO_PROYECTO_LABELS } from '../types'
import type { AttRecord } from '../types'

const FONT = 'Calibri'
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
function fechaLarga(d = new Date()) {
  return `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`
}
function fechaDesdeISO(iso?: string): string {
  if (!iso) return fechaLarga()
  const [y, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2,'0')} ${MESES[m - 1]} ${y}`
}

// ─── Unidades ────────────────────────────────────────────────────────────────
const IN   = 914400   // 1 inch en EMU
const TWIP = 1440     // twips por pulgada

// ─── Layout page ─────────────────────────────────────────────────────────────
const PAGE_W   = Math.round(8.5  * TWIP)   // 12240 twips
const MARGIN   = Math.round(1.25 * TWIP)   // 1800 twips
const PAGE_COL = PAGE_W - 2 * MARGIN       // 8640 twips columna útil

// ─── Helpers imagen ───────────────────────────────────────────────────────────
function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64.trim())
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf
}

async function urlToBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  return res.arrayBuffer()
}

function getImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = reject
    img.src = url
  })
}

function scaleToBox(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / w, maxH / h)
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

// ─── Estilos comunes ──────────────────────────────────────────────────────────
const NoBorder = {
  top:    { style: BorderStyle.NIL,    size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NIL,    size: 0, color: 'auto' },
  left:   { style: BorderStyle.NIL,    size: 0, color: 'auto' },
  right:  { style: BorderStyle.NIL,    size: 0, color: 'auto' },
}

const ThinBorder = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'auto' },
}

function blueShading() {
  return { type: ShadingType.CLEAR, color: 'FFFFFF', fill: '0070C0' }
}

function boldRun(text: string) {
  return new TextRun({ text, bold: true, size: 22, font: 'Cambria' })
}

function labelRun(text: string) {
  return new TextRun({ text, size: 22, font: 'Cambria' })
}

function sectionHeading(text: string, newPage = false) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: '4F81BD', size: 26, font: FONT })],
    spacing: { before: 200, after: 0 },
    pageBreakBefore: newPage,
  })
}

// ─── Cabecera del documento (2 filas) ────────────────────────────────────────
// Tabla más ancha que el cuerpo usando indent negativo
const HDR_INDENT = 400                          // twips hacia la izquierda
const HDR_W      = PAGE_COL + HDR_INDENT * 2   // 8640 + 800 = 9440 twips
const HDR_COLS   = [1530, 5500, 2410]           // suma 9440

const HDR_D = { style: BorderStyle.DOUBLE, size: 8, color: 'auto' }
const HDR_S = { style: BorderStyle.SINGLE, size: 4, color: 'auto' }
function hdrBord(top: boolean, btm: boolean, lft: boolean, rgt: boolean) {
  const b = (outer: boolean) => outer ? HDR_D : HDR_S
  return { top: b(top), bottom: b(btm), left: b(lft), right: b(rgt) }
}

const ROW_H = { height: { value: 700, rule: HeightRule.ATLEAST } }

function makeHeader(record: AttRecord, fecha: string): Header {
  const ott      = record.ott || ''
  const titulo   = record.tituloInforme?.trim() || `Informe posterior OTT ${ott}`
  const cs       = record.codigoServicio ?? ''
  const csNombre = [cs, record.nombreServicio].filter(Boolean).join(' ')

  const logoData = b64ToUint8(ATT_LOGO_B64)
  const LOGO_W   = 110
  const LOGO_H   = Math.round(LOGO_W * 92 / 315)

  return new Header({
    children: [
      new Table({
        width:        { size: HDR_W, type: WidthType.DXA },
        indent:       { size: -HDR_INDENT, type: WidthType.DXA },
        columnWidths: HDR_COLS,
        rows: [
          // ── Fila 1: logo | título | fecha ──
          new TableRow({
            height: ROW_H.height,
            children: [
              // Logo
              new TableCell({
                borders: hdrBord(true, false, true, false),
                verticalAlign: VerticalAlign.CENTER,
                width: { size: HDR_COLS[0], type: WidthType.DXA },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new ImageRun({
                    data: logoData,
                    transformation: { width: LOGO_W, height: LOGO_H },
                    type: 'jpg',
                  })],
                  spacing: { before: 40, after: 40 },
                })],
              }),
              // Título del informe
              new TableCell({
                borders: hdrBord(true, false, false, false),
                verticalAlign: VerticalAlign.CENTER,
                width: { size: HDR_COLS[1], type: WidthType.DXA },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: titulo, bold: true, size: 32, font: 'Verdana' })],
                  spacing: { before: 40, after: 40 },
                })],
              }),
              // Fecha
              new TableCell({
                borders: hdrBord(true, false, false, true),
                verticalAlign: VerticalAlign.CENTER,
                width: { size: HDR_COLS[2], type: WidthType.DXA },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: 'FECHA INFORME', bold: true, size: 24, font: FONT })],
                    spacing: { before: 40, after: 20 },
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: fecha, size: 20, font: FONT })],
                    spacing: { before: 0, after: 40 },
                  }),
                ],
              }),
            ],
          }),
          // ── Fila 2: OTT | código servicio | página ──
          new TableRow({
            height: ROW_H.height,
            children: [
              // OTT
              new TableCell({
                borders: hdrBord(false, true, true, false),
                verticalAlign: VerticalAlign.CENTER,
                width: { size: HDR_COLS[0], type: WidthType.DXA },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: ott, size: 20, font: 'Cambria' })],
                  spacing: { before: 40, after: 40 },
                })],
              }),
              // Código de servicio + Nombre
              new TableCell({
                borders: hdrBord(false, true, false, false),
                verticalAlign: VerticalAlign.CENTER,
                width: { size: HDR_COLS[1], type: WidthType.DXA },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: csNombre, size: 20, font: FONT })],
                  spacing: { before: 40, after: 40 },
                })],
              }),
              // Página x de y
              new TableCell({
                borders: hdrBord(false, true, false, true),
                verticalAlign: VerticalAlign.CENTER,
                width: { size: HDR_COLS[2], type: WidthType.DXA },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: 'Página ', bold: true, size: 24, font: FONT }),
                    new SimpleField('PAGE'),
                    new TextRun({ text: ' de ', bold: true, size: 24, font: FONT }),
                    new SimpleField('NUMPAGES'),
                  ],
                  spacing: { before: 40, after: 40 },
                })],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

// ─── Sección 1: Tipo de proyecto ──────────────────────────────────────────────
const TIPO_GRID: [keyof typeof TIPO_PROYECTO_LABELS, keyof typeof TIPO_PROYECTO_LABELS][] = [
  ['acceso_fijo',       'backhaul'],
  ['conectividad_movil','acceso_b2b'],
  ['proyectos_acceso',  'modernizacion'],
  ['vulnerabilidad',    'adaptacion'],
]

function tipoLabelCell(tipo: keyof typeof TIPO_PROYECTO_LABELS) {
  return new TableCell({
    width: { size: Math.round(0.38 * PAGE_COL), type: WidthType.DXA },
    shading: blueShading(),
    borders: ThinBorder,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: TIPO_PROYECTO_LABELS[tipo], bold: true, color: 'FFFFFF', font: 'Arial Black', size: 18 })],
      spacing: { before: 40, after: 40 },
    })],
  })
}

function tipoCheckCell(selected: boolean) {
  return new TableCell({
    width: { size: Math.round(0.12 * PAGE_COL), type: WidthType.DXA },
    borders: ThinBorder,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: selected ? 'X' : '', bold: true, size: 22, font: FONT })],
      spacing: { before: 40, after: 40 },
    })],
  })
}

function makeTipoTable(selected: string) {
  return new Table({
    width: { size: PAGE_COL, type: WidthType.DXA },
    rows: TIPO_GRID.map(([left, right]) =>
      new TableRow({
        children: [
          tipoLabelCell(left),
          tipoCheckCell(selected === left),
          tipoLabelCell(right),
          tipoCheckCell(selected === right),
        ],
      })
    ),
  })
}

// ─── Sección 2: Datos del proyecto ────────────────────────────────────────────
function datoPara(label: string, value: string) {
  return new Paragraph({
    children: [labelRun(label), boldRun(value || ' ')],
    spacing: { before: 40, after: 40 },
  })
}

function coordsPara(label: string, lat: string, lng: string) {
  return new Paragraph({
    children: [
      labelRun(label),
      boldRun(' Latitud: '), labelRun(`${lat || ''}  S`),
      labelRun('               '),
      boldRun('Longitud: '), labelRun(`${lng || ''}  W`),
    ],
    spacing: { before: 40, after: 40 },
  })
}

function makeDatosSection(r: AttRecord) {
  const idProyecto = [r.ott, r.codigoServicio].filter(Boolean).join(' - ')
  return [
    datoPara('Nombre del proyecto: ', r.nombreProyecto),
    datoPara('Iniciativa del proyecto: ', r.iniciativa),
    datoPara('ID de Proyecto: ', idProyecto),
    datoPara('Ingeniero Proyecto: ', r.ingenieroProyecto),
    datoPara('Jefe de Proyecto: ', r.jefeProyecto),
    datoPara('Comuna: ', r.comuna),
    datoPara('Región: ', r.region),
    datoPara('Contratista: ', r.contratista),
    coordsPara('Coordenadas de inicio:  ', r.coordsInicio.lat, r.coordsInicio.lng),
    coordsPara('Coordenadas de término: ', r.coordsTermino.lat, r.coordsTermino.lng),
  ]
}

// ─── Sección 3: Descripción general ──────────────────────────────────────────
function para(text: string, opts: { bold?: boolean; indent?: boolean } = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, font: 'Cambria', bold: opts.bold })],
    spacing: { before: 40, after: 40 },
    indent: opts.indent ? { left: 360 } : undefined,
  })
}

function hitoPara(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, font: 'Aptos' })],
    spacing: { before: 40, after: 40 },
    indent: { left: 360 },
  })
}

function makeDescripcionSection(r: AttRecord) {
  const items: Paragraph[] = []

  // Tendidos (formato redactado, uno por párrafo)
  const validTramos = r.tramos.filter(t => t.tipoCable || t.metraje || t.desde || t.hasta)
  for (let ti = 0; ti < validTramos.length; ti++) {
    const t   = validTramos[ti]
    const end = ti === validTramos.length - 1 ? '.' : ';'
    const sentence =
      `Se realiza tendido de ${t.metraje || '___'}m de cable ${t.tipoCable || '___'} ` +
      `desde ${t.desde || '___'} hasta ${t.hasta || '___'}${end}`
    items.push(para(sentence))
  }

  if (r.instalaCMIC)          items.push(para('Se instala CMIC en cliente;'))
  if (r.instalaMufas)         items.push(para('Se instala mufa proyectada;'))
  if (r.tieneReparacionDucto) items.push(para('Se realiza calicata y reparación de ducto;'))

  if (r.tieneIngresoRed) {
    items.push(para('Con ingreso a red;'))
    const { nodo, rack, odf, fo } = r.ingresoRed
    if (nodo) items.push(para(`NODO    ${nodo}`, { indent: true }))
    if (rack) items.push(para(`RACK    ${rack}`, { indent: true }))
    if (odf)  items.push(para(`ODF     ${odf}`,  { indent: true }))
    if (fo)   items.push(para(`FO      ${fo}`,   { indent: true }))
  }

  for (const h of r.hitos) {
    const text = [h.fecha, h.descripcion].filter(Boolean).join(' — ')
    if (text) items.push(hitoPara(`• ${text}`))
  }

  if (items.length === 0) {
    items.push(para(' '))
  }

  return items
}

// ─── Sección 4: Infraestructura ───────────────────────────────────────────────
const INFRA_COL = [
  Math.round(0.55 * PAGE_COL),
  Math.round(0.15 * PAGE_COL),
  Math.round(0.15 * PAGE_COL),
  Math.round(0.15 * PAGE_COL),
]

function infraHeaderCell(text: string) {
  return new TableCell({
    shading: blueShading(),
    borders: ThinBorder,
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 28, font: 'Arial Black' })],
    })],
  })
}

function infraDataCell(text: string, center = false) {
  return new TableCell({
    borders: ThinBorder,
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    children: [new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text, size: 22, font: 'Arial' })],
    })],
  })
}

function makeInfraTable(r: AttRecord) {
  const { postesElectricos: pe, postesOtraTeleco: pt, ductosOtraTeleco: dt, fibraOtraCompania: fo, postesEntel: pE } = r.infraestructura
  return new Table({
    width: { size: PAGE_COL, type: WidthType.DXA },
    columnWidths: INFRA_COL,
    rows: [
      new TableRow({ children: [infraHeaderCell('Infraestructura'), infraHeaderCell('Sí / No'), infraHeaderCell('Cantidad'), infraHeaderCell('Compañía')] }),
      new TableRow({ children: [infraDataCell('¿Utiliza postes eléctricos?'), infraDataCell(pe.usa ? 'SI' : 'NO', true), infraDataCell(pe.usa ? pe.cantidad : '', true), infraDataCell(pe.usa ? pe.compania : '')] }),
      new TableRow({ children: [infraDataCell('¿Utiliza postes de otra compañía de teleco?'), infraDataCell(pt.usa ? 'SI' : 'NO', true), infraDataCell(pt.usa ? pt.cantidad : '', true), infraDataCell(pt.usa ? pt.compania : '')] }),
      new TableRow({ children: [infraDataCell('¿Utiliza ductos de otra compañía de teleco?'), infraDataCell(dt.usa ? 'SI' : 'NO', true), infraDataCell(dt.usa ? dt.cantidad : '', true), infraDataCell(dt.usa ? dt.compania : '')] }),
      new TableRow({ children: [infraDataCell('¿Utiliza fibra óptica de otra compañía?'), infraDataCell(fo.usa ? 'SI' : 'NO', true), infraDataCell('', true), infraDataCell('')] }),
      new TableRow({ children: [infraDataCell('¿Se proyectan postes/ductos de Entel?'), infraDataCell(pE.usa ? 'SI' : 'NO', true), infraDataCell('', true), infraDataCell('')] }),
    ],
  })
}

// ─── Sección 5: Registro fotográfico ─────────────────────────────────────────
const CAT_KEY_TO_LABEL: Record<string, string> = {
  tendidoFO:       'TENDIDO FO',
  cmic:            'CMIC',
  medicionTraza:   'MEDICIÓN TRAZA',
  reparacionDucto: 'REPARACIÓN DE DUCTO',
  mufaProyectada:  'MUFA PROYECTADA',
  ingresoRed:      'INGRESO A RED',
}

function fotoLabel(f: AttRecord['fotos'][number]): string {
  if (f.categoria === 'otro') return (f.otroLabel?.trim() || 'OTRO').toUpperCase()
  return CAT_KEY_TO_LABEL[f.categoria] ?? f.categoria.toUpperCase()
}

// Dimensiones de fotos (px a 96 DPI)
const PORT_MAX_W = Math.round(2.7 * 96)   // 259 px — por columna portrait
const PORT_MAX_H = Math.round(3.5 * 96)   // 336 px
const LAND_MAX_W = Math.round(5.6 * 96)   // 538 px — foto horizontal (OTDR)
const LAND_MAX_H = Math.round(3.5 * 96)   // 336 px
const AEREO_MAX_W = Math.round(4.5 * 96)  // 432 px — foto aérea
const AEREO_MAX_H = Math.round(3.5 * 96)  // 336 px

// Espaciado entre cuadros de fotos (twips)
const CELL_GAP  = 180   // espacio lateral entre par de fotos (≈ 0.125")
const LABEL_GAP = 60    // espacio entre cuadro-label y cuadro-foto (row exacta)
const PORT_COL  = Math.floor((PAGE_COL - CELL_GAP) / 2)  // 4230 twips

interface PhotoData { buffer: ArrayBuffer; wPx: number; hPx: number; isLandscape: boolean }

async function fetchPhoto(url: string, forceLandscape = false): Promise<PhotoData | null> {
  try {
    const [buf, dims] = await Promise.all([urlToBuffer(url), getImageSize(url)])
    const isLandscape = forceLandscape || dims.w > dims.h * 1.3
    const s = scaleToBox(dims.w, dims.h, isLandscape ? LAND_MAX_W : PORT_MAX_W, isLandscape ? LAND_MAX_H : PORT_MAX_H)
    return { buffer: buf, wPx: s.w, hPx: s.h, isLandscape }
  } catch {
    return null
  }
}

async function fetchAereoPhoto(url: string): Promise<{ buffer: ArrayBuffer; wPx: number; hPx: number } | null> {
  try {
    const [buf, dims] = await Promise.all([urlToBuffer(url), getImageSize(url)])
    const s = scaleToBox(dims.w, dims.h, AEREO_MAX_W, AEREO_MAX_H)
    return { buffer: buf, wPx: s.w, hPx: s.h }
  } catch {
    return null
  }
}

// Celda vacía sin bordes (columna separadora o fila espaciadora)
function gapCell(w: number) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: NoBorder,
    children: [new Paragraph({ spacing: { before: 0, after: 0 } })],
  })
}

// Fila espaciadora de altura exacta (sin bordes, no se parte entre páginas)
function spacerRow(colWidths: number[]) {
  return new TableRow({
    cantSplit: true,
    height: { value: LABEL_GAP, rule: HeightRule.EXACT },
    children: colWidths.map((w) => gapCell(w)),
  })
}

// Celda de etiqueta con borde
function labelCell(text: string, w: number) {
  return new TableCell({
    borders: ThinBorder,
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 18, font: FONT })],
      spacing: { before: 40, after: 40 },
    })],
  })
}

// Celda de foto con borde
function photoCell(photo: PhotoData | null, w: number) {
  return new TableCell({
    borders: ThinBorder,
    verticalAlign: VerticalAlign.TOP,
    width: { size: w, type: WidthType.DXA },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: photo
        ? [new ImageRun({ data: photo.buffer, transformation: { width: photo.wPx, height: photo.hPx }, type: 'jpg' })]
        : [],
      spacing: { before: 40, after: 40 },
    })],
  })
}

// Tabla con un grupo de fotos: [label|gap|label] / spacerRow / [foto|gap|foto]
function photoGroupTable(
  labels: string[],
  photos: (PhotoData | null)[],
  colW: number,
  isLandscape = false,
): Table {
  const withGap = !isLandscape && labels.length === 2
  const colWidths = withGap ? [colW, CELL_GAP, colW] : [colW]
  const totalW    = withGap ? colW * 2 + CELL_GAP : colW

  const labelRowCells = withGap
    ? [labelCell(labels[0], colW), gapCell(CELL_GAP), labelCell(labels[1], colW)]
    : [labelCell(labels[0], colW)]

  const photoRowCells = withGap
    ? [photoCell(photos[0], colW), gapCell(CELL_GAP), photoCell(photos[1], colW)]
    : [photoCell(photos[0], colW)]

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ cantSplit: true, children: labelRowCells }),
      spacerRow(colWidths),
      new TableRow({ cantSplit: true, children: photoRowCells }),
    ],
  })
}

// Párrafo separador entre grupos en la misma página
function groupSep() {
  return new Paragraph({
    children: [new TextRun({ text: ' ', font: FONT, size: 20 })],
    spacing: { before: 80, after: 40 },
  })
}

// Salto de página explícito entre páginas de fotos
function photoPageBreak() {
  return new Paragraph({
    pageBreakBefore: true,
    children: [new TextRun({ text: '', font: FONT, size: 20 })],
    spacing: { before: 0, after: 0 },
  })
}

async function makeFotosSection(r: AttRecord) {
  const elements: (Paragraph | Table)[] = []
  if (r.fotos.length === 0) return elements

  // medicionTraza always after all other photos (matches PDF ordering)
  const fotos = [
    ...r.fotos.filter(f => f.categoria !== 'medicionTraza'),
    ...r.fotos.filter(f => f.categoria === 'medicionTraza'),
  ]

  const photos = await Promise.all(
    fotos.map((f) => f.previewUrl
      ? fetchPhoto(f.previewUrl, f.categoria === 'medicionTraza')
      : Promise.resolve(null)
    )
  )

  let i = 0
  let groupsOnPage = 0

  while (i < fotos.length) {
    const photo  = photos[i]
    const label  = fotoLabel(fotos[i])
    const isLand = photo?.isLandscape ?? false

    // A landscape photo counts as 2 portrait slots (full page width)
    const slotsNeeded = isLand ? 2 : 1

    if (groupsOnPage > 0 && groupsOnPage + slotsNeeded > 4) {
      // This group won't fit on the current page — break to next
      elements.push(photoPageBreak())
      groupsOnPage = 0
    } else if (groupsOnPage > 0) {
      elements.push(groupSep())
    }

    if (isLand) {
      elements.push(photoGroupTable([label], [photo], PAGE_COL, true))
      groupsOnPage += 2
    } else if (i + 1 < fotos.length && !(photos[i + 1]?.isLandscape)) {
      // Par de fotos verticales — counts as 2 slots
      const photo2 = photos[i + 1]
      const label2 = fotoLabel(fotos[i + 1])
      elements.push(photoGroupTable([label, label2], [photo, photo2], PORT_COL))
      i++
      groupsOnPage += 2
    } else {
      // Foto vertical sola
      elements.push(photoGroupTable([label], [photo], PORT_COL))
      groupsOnPage += 1
    }

    i++
  }

  return elements
}

// ─── Foto aérea (página 2) ────────────────────────────────────────────────────
async function makeAereoBlock(r: AttRecord, pageBreak: boolean): Promise<(Paragraph | Table)[]> {
  if (!r.fotoAerea?.previewUrl) return []
  const photo = await fetchAereoPhoto(r.fotoAerea.previewUrl)
  if (!photo) return []

  return [
    new Paragraph({
      pageBreakBefore: pageBreak,
      children: [new TextRun({
        text: r.fotoAereaTipo === 'calle' ? 'FOTO DE CALLE' : 'FOTO AÉREA',
        bold: true, color: '4F81BD', size: 22, font: FONT,
      })],
      spacing: { before: 0, after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        data: photo.buffer,
        transformation: { width: photo.wPx, height: photo.hPx },
        type: 'jpg',
      })],
      spacing: { before: 0, after: 160 },
    }),
  ]
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function generarInformeAtt(record: AttRecord): Promise<Blob> {
  const fecha = fechaDesdeISO(record.fecha)

  const [fotosElements, aereoElements] = await Promise.all([
    makeFotosSection(record),
    makeAereoBlock(record, true),
  ])
  const hasAereo = aereoElements.length > 0

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size:   { width: PAGE_W, height: Math.round(11 * TWIP) },
          margin: {
            top:    Math.round(0.49 * TWIP),
            right:  MARGIN,
            bottom: Math.round(0.30 * TWIP),
            left:   MARGIN,
            header: Math.round(0.50 * TWIP),
            footer: Math.round(0.50 * TWIP),
          },
        },
      },
      headers: { default: makeHeader(record, fecha) },
      children: [
        // ── Página 1: secciones 1, 2, 3 ──
        sectionHeading('1. TIPO DE PROYECTO'),
        new Paragraph({ spacing: { before: 0, after: 80 } }),
        makeTipoTable(record.tipoProyecto),
        new Paragraph({ spacing: { before: 80, after: 0 } }),

        sectionHeading('2. DATOS DEL PROYECTO'),
        new Paragraph({ spacing: { before: 0, after: 80 } }),
        ...makeDatosSection(record),
        new Paragraph({ spacing: { before: 80, after: 0 } }),

        sectionHeading('3. DESCRIPCIÓN GENERAL DEL PROYECTO'),
        ...makeDescripcionSection(record),

        // ── Página 2: Foto aérea (si existe) + sección 4 ──
        // Si hay foto aérea, ella lleva el pageBreak; si no, lo lleva sección 4
        ...aereoElements,
        sectionHeading('4. INFRAESTRUCTURA PARA UTILIZAR', !hasAereo),
        new Paragraph({ spacing: { before: 0, after: 80 } }),
        makeInfraTable(record),
        new Paragraph({ spacing: { before: 80, after: 0 } }),

        // ── Página 3+: Sección 5 fotos ──
        sectionHeading('5. DETALLE DE SINGULARIDADES Y REGISTROS FOTOGRÁFICOS.', true),
        ...fotosElements,
      ],
    }],
  })

  return Packer.toBlob(doc)
}
