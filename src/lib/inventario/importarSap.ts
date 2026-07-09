// Parseo de reportes de stock exportados desde SAP (formato confirmado con
// un archivo real: columnas SAP/MATERIAL/CENTRO/ALM/PEP/LOTE/STOCK/Fisico).
// Solo SAP (código), MATERIAL (descripción), LOTE y STOCK son relevantes acá
// — CENTRO/ALM/PEP son metadatos internos de SAP sin equivalente en nuestro
// esquema, y "Fisico" viene vacía (para llenar a mano en el propio Excel).
// Acepta tanto un archivo .xlsx como texto pegado (tab-separado, como al
// copiar celdas directamente desde Excel) — ambos terminan en la misma
// matriz de filas crudas antes de normalizar.

export interface FilaImportSap {
  sku: string
  descripcion: string
  lote: string
  cantidad: number
}

const ALIASES: Record<keyof FilaImportSap, string[]> = {
  sku: ['sap', 'sku', 'codigo', 'código', 'codigo material', 'código material'],
  descripcion: ['material', 'descripcion', 'descripción', 'descripcion material', 'descripción material'],
  lote: ['lote', 'lote sap'],
  cantidad: ['stock', 'cantidad', 'cant', 'cant.'],
}

/** Nombre legible por campo, para el mensaje de error cuando falta alguno. */
const NOMBRE_CAMPO: Record<keyof FilaImportSap, string> = {
  sku: 'código (SAP)', descripcion: 'material', lote: 'lote', cantidad: 'stock/cantidad',
}

function normalizarEncabezado(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/**
 * Recibe una matriz de filas crudas y devuelve las filas normalizadas,
 * agrupando por sku+lote. Ubica las columnas por el TEXTO del encabezado,
 * no por posición — columnas de más (CENTRO/ALM/PEP/etc.) o en otro orden
 * no afectan el resultado. Si no encuentra los 4 campos requeridos en
 * ninguna fila, reporta cuáles le faltaron en la fila que más se acercó,
 * para que quien sube el archivo sepa qué encabezado corregir.
 */
export function parseFilasSap(rows: unknown[][]): FilaImportSap[] {
  let headerIdx = -1
  let colIndex: Partial<Record<keyof FilaImportSap, number>> = {}
  let mejorCandidata: { fila: number; found: Partial<Record<keyof FilaImportSap, number>>; encabezados: string[] } | null = null

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const found: Partial<Record<keyof FilaImportSap, number>> = {}
    rows[i].forEach((cell, j) => {
      const h = normalizarEncabezado(cell)
      for (const key of Object.keys(ALIASES) as (keyof FilaImportSap)[]) {
        if (found[key] === undefined && ALIASES[key].includes(h)) found[key] = j
      }
    })
    if (found.sku !== undefined && found.descripcion !== undefined && found.lote !== undefined && found.cantidad !== undefined) {
      headerIdx = i
      colIndex = found
      break
    }
    if (!mejorCandidata || Object.keys(found).length > Object.keys(mejorCandidata.found).length) {
      mejorCandidata = { fila: i, found, encabezados: rows[i].map((c) => String(c ?? '').trim()).filter(Boolean) }
    }
  }

  if (headerIdx === -1) {
    const faltantes = (Object.keys(NOMBRE_CAMPO) as (keyof FilaImportSap)[])
      .filter((k) => mejorCandidata?.found[k] === undefined)
      .map((k) => NOMBRE_CAMPO[k])
    const detalle = mejorCandidata && mejorCandidata.encabezados.length > 0
      ? ` La fila de encabezados que más se parece dice: "${mejorCandidata.encabezados.join(', ')}".`
      : ''
    throw new Error(
      `No se reconoció la columna de ${faltantes.join(', ') || 'encabezados'} — revisa que la fila de títulos use ese nombre.${detalle}`,
    )
  }

  const porClave = new Map<string, FilaImportSap>()
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const sku = String(row[colIndex.sku!] ?? '').trim()
    const descripcion = String(row[colIndex.descripcion!] ?? '').trim()
    const lote = String(row[colIndex.lote!] ?? '').trim() || 'SinDefinir'
    const cantidadRaw = row[colIndex.cantidad!]
    const cantidad = typeof cantidadRaw === 'number' ? cantidadRaw : Number(String(cantidadRaw ?? '').trim().replace(',', '.'))
    if (!sku || Number.isNaN(cantidad)) continue

    const clave = `${sku}|${lote}`
    const previa = porClave.get(clave)
    if (previa) previa.cantidad += cantidad
    else porClave.set(clave, { sku, descripcion, lote, cantidad })
  }
  return [...porClave.values()]
}

/** Parsea texto pegado (tab-separado, como al copiar celdas de Excel e incluir la fila de encabezados). */
export function parseTextoPegado(texto: string): FilaImportSap[] {
  const rows = texto.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => l.split('\t'))
  return parseFilasSap(rows)
}

function celdaATexto(v: unknown): unknown {
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString()
    if ('result' in v) return (v as { result: unknown }).result
    if ('text' in v) return (v as { text: unknown }).text
    return String(v)
  }
  return v
}

/** Parsea un archivo .xlsx subido (ExcelJS, carga perezosa — mismo bundle ya usado para generar informes). */
export async function parseArchivoXlsx(file: File): Promise<FilaImportSap[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJSMod = await import('exceljs') as any
  const Workbook = ExcelJSMod.Workbook ?? ExcelJSMod.default?.Workbook ?? ExcelJSMod.default
  const workbook = new Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws = workbook.worksheets[0] as any
  if (!ws) throw new Error('El archivo no tiene hojas')

  const rows: unknown[][] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow({ includeEmpty: false }, (row: any) => {
    const values: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell({ includeEmpty: true }, (cell: any) => { values.push(celdaATexto(cell.value)) })
    rows.push(values)
  })
  return parseFilasSap(rows)
}
