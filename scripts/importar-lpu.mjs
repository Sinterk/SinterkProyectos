// Importa el catálogo LPU (Lista de Precios Unitarios) de ATT desde el
// Excel mensual real de facturación a Entel (.xlsm, ej. "eneroEP03 SINTERK
// ENERO2026_A.xlsm") a las tablas lpu_codigos/lpu_precios_zona (hoja "LPU
// Obras por Zonas") y lpu_ito_servicios (hoja "LPU Sup Itos obras e Itos
// serv") — ver 0031_lpu_codigos.sql + 0033_lpu_ito_fix.sql.
//
// Decisión de Andrés Barahona: transcripción fiel, sin interpretar — este
// script no mapea códigos a materiales ni tendidos (eso es
// lpu_material_map/lpu_tendido_map, configurables por admin desde la app).
//
// Layout real de "LPU Obras por Zonas" (confirmado leyendo el .xlsm real,
// NO es una única fila de encabezados):
//   - Fila con la celda "Corr": a partir de ahí, en el mismo renglón y por
//     posición relativa (no por texto, porque no todas tienen encabezado):
//       corr-2 = columna sin encabezado visible ("grupo", se preserva igual)
//       corr-1 = "Estado" (VIGENTE/NO DISPONIBLE/ELIMINADO — sin encabezado
//                de texto tampoco, solo se infiere por posición)
//       corr   = Corr
//       corr+1 = Código ATT
//       corr+2 = Partida
//       corr+3 = Descripción
//       corr+4 = Unidad
//       corr+5 = Tipo
//   - Los nombres de zona (13: SUR, XI Región, XII Región, RM-CENTRO, V
//     REGION, CENTRO SUR, COPIAPO, AFTA, ARICA, IQUIQUE, LA SERENA, CALAMA,
//     CENTRO) están en la fila INMEDIATAMENTE ANTERIOR, a partir de la
//     columna corr+6 — no en la misma fila que Corr/Código/etc.
//   - Filas de categoría/subcategoría (ej. "OBRAS CIVILES") tienen texto
//     solo en la columna Partida, sin Descripción — se descartan exigiendo
//     código Y descripción no vacíos.
//
// Layout real de "LPU Sup Itos obras e Itos serv" (NO tiene zonas ni código
// LPU — es una tabla plana de 4 columnas: Prestación, Valor Unit($) base,
// Reajuste($), Valor Unit($) final, agrupada en secciones marcadas por una
// fila con solo la 1ª columna llena, ej. "Supervisores EOATT" / "ITO OBRAS"
// / "ITO Servicio Telco"). Las filas "Prestación/Valor Unit($)/..." son el
// encabezado repetido de cada sección y se ignoran.
//
// Es SEGURO volver a correrlo: upsert por código_att / (categoría,
// prestación) — un reajuste mensual de precios pisa la fila existente.
//
// Uso (PowerShell, desde la raíz del repo):
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "tu_clave_aqui"
//   node scripts/importar-lpu.mjs "ruta\al\eneroEP03 SINTERK ENERO2026_A.xlsm"

import { createClient } from '@supabase/supabase-js'
import XLSXMod from 'xlsx-js-style'
const XLSX = XLSXMod.default ?? XLSXMod

const SUPABASE_URL = 'https://xwawplezarrfonuyaaxu.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const archivo = process.argv[2]

const HOJA_LPU = 'LPU Obras por Zonas'
const HOJA_ITO = 'LPU Sup Itos obras e Itos serv'

if (!SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  process.exit(1)
}
if (!archivo) {
  console.error('Uso: node scripts/importar-lpu.mjs ruta\\al\\archivo.xlsm')
  process.exit(1)
}

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g')
function normalizarHeader(v) {
  return String(v ?? '')
    .normalize('NFD').replace(DIACRITICOS, '')
    .replace(/\s+/g, '').toLowerCase()
}
function texto(v) {
  return String(v ?? '').trim()
}
function numeroONull(v) {
  if (v === '' || v === undefined || v === null) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// ---------- LPU Obras por Zonas ----------

function encontrarFilaYColumnaCorr(matriz) {
  for (let i = 0; i < Math.min(matriz.length, 20); i++) {
    const idx = (matriz[i] || []).findIndex((h) => normalizarHeader(h) === 'corr')
    if (idx !== -1) return { fila: i, col: idx }
  }
  return null
}

// Busca, en las filas inmediatamente ANTERIORES a la de campos fijos, la
// primera con varias celdas de texto no vacías a partir de `desdeCol`
// (los nombres de zona) — no siempre es la fila justo encima si hay
// renglones intermedios en blanco.
function encontrarFilaZona(matriz, filaFija, desdeCol) {
  for (let i = filaFija - 1; i >= Math.max(0, filaFija - 6); i--) {
    const fila = matriz[i] || []
    const nombres = fila.slice(desdeCol).filter((v) => texto(v) !== '')
    if (nombres.length >= 3) return i
  }
  return -1
}

function leerLpuObrasPorZonas(wb) {
  const ws = wb.Sheets[HOJA_LPU]
  if (!ws) {
    console.error(`✗ No se encontró la hoja "${HOJA_LPU}". Hojas disponibles: ${wb.SheetNames.join(', ')}`)
    return null
  }
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false })

  const anclaCorr = encontrarFilaYColumnaCorr(matriz)
  if (!anclaCorr) {
    console.error(`✗ No se encontró la columna "Corr" en "${HOJA_LPU}" dentro de las primeras 20 filas.`)
    return null
  }
  const { fila: filaFija, col: colCorr } = anclaCorr
  const cols = {
    grupo: colCorr - 2, estado: colCorr - 1, corr: colCorr,
    codigo_att: colCorr + 1, partida: colCorr + 2, descripcion: colCorr + 3,
    unidad: colCorr + 4, tipo: colCorr + 5,
  }

  const filaZona = encontrarFilaZona(matriz, filaFija, cols.tipo + 1)
  const headerZona = filaZona >= 0 ? matriz[filaZona] : []
  const columnasZona = []
  for (let c = cols.tipo + 1; c < headerZona.length; c++) {
    const nombre = texto(headerZona[c])
    if (nombre) columnasZona.push({ idx: c, zona: nombre })
  }
  console.log(`  Fila de campos fijos: ${filaFija + 1} (Corr en columna ${colCorr + 1}). Fila de zonas: ${filaZona >= 0 ? filaZona + 1 : '(no encontrada)'}.`)
  console.log(`  Zonas detectadas (${columnasZona.length}): ${columnasZona.map((c) => c.zona).join(', ') || '(ninguna)'}`)

  const registros = []
  for (let i = filaFija + 1; i < matriz.length; i++) {
    const fila = matriz[i]
    if (!fila) continue
    const codigo_att = texto(fila[cols.codigo_att])
    const descripcion = texto(fila[cols.descripcion])
    if (!codigo_att || !descripcion) continue // fila de categoría/subcategoría, no es un ítem

    const precios = {}
    for (const { idx, zona } of columnasZona) {
      const n = numeroONull(fila[idx])
      if (n !== null) precios[zona] = n
    }

    registros.push({
      grupo: numeroONull(fila[cols.grupo]),
      estado: texto(fila[cols.estado]) || null,
      corr: numeroONull(fila[cols.corr]),
      codigo_att,
      partida: texto(fila[cols.partida]) || null,
      descripcion,
      unidad: texto(fila[cols.unidad]) || null,
      tipo: texto(fila[cols.tipo]) || null,
      precios,
    })
  }
  return registros
}

// ---------- LPU Sup Itos obras e Itos serv ----------

function leerItoServicios(wb) {
  const ws = wb.Sheets[HOJA_ITO]
  if (!ws) {
    console.error(`✗ No se encontró la hoja "${HOJA_ITO}". Hojas disponibles: ${wb.SheetNames.join(', ')}`)
    return null
  }
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false })

  const registros = []
  let categoria = null
  for (const fila of matriz) {
    const prestacion = texto(fila[0])
    if (!prestacion) continue
    if (normalizarHeader(prestacion) === 'prestacion') continue // encabezado repetido de sección

    const valorBase = numeroONull(fila[1])
    if (valorBase === null) {
      categoria = prestacion // fila de solo texto = nombre de sección
      continue
    }
    registros.push({
      categoria: categoria || '(sin sección)',
      prestacion,
      valor_unitario_base: valorBase,
      reajuste: numeroONull(fila[2]) ?? 0,
      valor_unitario_final: numeroONull(fila[3]) ?? 0,
    })
  }
  return registros
}

// ---------- Escritura a Supabase ----------

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function enLotes(arr, tam) {
  const lotes = []
  for (let i = 0; i < arr.length; i += tam) lotes.push(arr.slice(i, i + tam))
  return lotes
}

async function importarLpuCodigos(registros) {
  // codigo_att es unique (0035_lpu_codigo_att_unique.sql) — un solo upsert
  // por lote en vez de un find+insert/update por fila (era ~900 llamadas
  // HTTP secuenciales, muy lento y con más ventana para fallos de red).
  const payloadCodigos = registros.map((r) => ({
    grupo: r.grupo, estado: r.estado, corr: r.corr, codigo_att: r.codigo_att,
    partida: r.partida, descripcion: r.descripcion, unidad: r.unidad, tipo: r.tipo,
  }))

  const { data: guardados, error } = await supabase
    .from('lpu_codigos').upsert(payloadCodigos, { onConflict: 'codigo_att' }).select('id, codigo_att')
  if (error) { console.error(`✗ error guardando lpu_codigos: ${error.message}`); return }
  console.log(`  ${guardados.length} código(s) escritos (upsert por codigo_att).`)

  const idPorCodigo = new Map(guardados.map((g) => [g.codigo_att, g.id]))
  const filasPrecios = registros.flatMap((r) => {
    const id = idPorCodigo.get(r.codigo_att)
    return Object.entries(r.precios).map(([zona, precio]) => ({ lpu_codigo_id: id, zona, precio }))
  })

  let precios = 0
  for (const lote of enLotes(filasPrecios, 500)) {
    const { error } = await supabase.from('lpu_precios_zona').upsert(lote, { onConflict: 'lpu_codigo_id,zona' })
    if (error) console.error(`  error guardando lote de precios por zona: ${error.message}`)
    else precios += lote.length
  }
  console.log(`  Precios de zona escritos: ${precios} de ${filasPrecios.length}.`)
}

async function importarItoServicios(registros) {
  // El Excel real trae prestaciones duplicadas literalmente (misma categoría
  // + mismo texto) — un upsert no puede afectar la misma fila dos veces
  // dentro del mismo lote, así que nos quedamos con la última ocurrencia.
  const porClave = new Map()
  for (const r of registros) porClave.set(`${r.categoria} ${r.prestacion}`, r)
  const unicos = [...porClave.values()]
  if (unicos.length < registros.length) {
    console.log(`  (${registros.length - unicos.length} fila(s) duplicada(s) en el Excel, se conserva la última)`)
  }

  const { error } = await supabase.from('lpu_ito_servicios')
    .upsert(unicos, { onConflict: 'categoria,prestacion' })
  if (error) console.error(`✗ error guardando lpu_ito_servicios: ${error.message}`)
  else console.log(`  ${unicos.length} fila(s) escritas (upsert por categoría+prestación).`)
}

const wb = XLSX.readFile(archivo, { bookVBA: true })

console.log(`\n[1/2] Hoja "${HOJA_LPU}"...`)
const registrosLpu = leerLpuObrasPorZonas(wb)
if (registrosLpu) {
  console.log(`  ${registrosLpu.length} fila(s) válida(s) encontradas.`)
  await importarLpuCodigos(registrosLpu)
}

console.log(`\n[2/2] Hoja "${HOJA_ITO}"...`)
const registrosIto = leerItoServicios(wb)
if (registrosIto) {
  console.log(`  ${registrosIto.length} fila(s) válida(s) encontradas.`)
  await importarItoServicios(registrosIto)
}

console.log('\nListo.')
