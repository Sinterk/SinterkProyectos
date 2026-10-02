// Rebaja masiva de incidencias OyM — pedido de Andrés: las rebajas de OyM se
// hacen una vez al mes aprox., varias incidencias a la vez, y se piden a la
// Mesa de Ayuda de Entel con UN correo que lleva dos tablas:
//   1. Resumen de material (SKU | DESCRIPCIÓN | LOTE | ALM | CECO | CANTIDAD | RETIRA),
//      agrupado por SKU+lote sumando todas las incidencias.
//   2. Detalle por incidencia (INCIDENCIA | Nombre técnico // Nombre ingeniero |
//      RUT | Material | Descripción | Lote | Cantidad).
// ALM/CECO/RETIRA son siempre los mismos (REBAJA_OYM).
//
// Preparar el correo NO toca la base; registrar la rebaja en el sistema
// (movimientos tipo `rebajado`, descuenta stock digital) es un paso aparte.

import { nanoid } from '@/core/utils/nanoid'
import { adminRepo } from '@/lib/adminRepo'
import { calcularLineasRebaja, nuevoLibroStock } from './calcularRebaja'
import { getResumenProyecto, listMateriales, listUbicaciones, registrarMovimiento } from './inventarioRepo'

export const REBAJA_OYM = { alm: 'C132', ceco: '70803', retira: 'SINTERK' } as const

export interface LineaRebajaMasiva {
  localId: string
  materialId: string
  sku: string
  descripcion: string
  /** Vacío = sin stock digital suficiente en la bodega — hay que completarlo o quitar la línea. */
  lote: string
  cantidad: string
  bodegaId: string
}

export interface IncidenciaRebaja {
  projectId: string
  codigo: string
  /** Nombre(s) del técnico asignado a la incidencia. Editable antes de generar el correo. */
  tecnico: string
  rut: string
  ingeniero: string
  lineas: LineaRebajaMasiva[]
}

/**
 * Calcula, para cada incidencia, qué material instalado falta rebajar y de qué
 * lote (mismas reglas que "Sugerir rebaja", ver calcularRebaja.ts). Se procesan
 * en orden con un mismo libro de stock: una incidencia no puede llevarse un
 * lote que la anterior ya consumió.
 */
export async function prepararRebajaMasiva(
  incidencias: { id: string; codigo: string; ingeniero: string }[],
): Promise<IncidenciaRebaja[]> {
  const [materiales, bodegas] = await Promise.all([listMateriales(), listUbicaciones({ tipo: 'bodega' })])
  const bodega = bodegas.find((b) => b.nombre === REBAJA_OYM.alm)
  if (!bodega) throw new Error(`No existe la bodega ${REBAJA_OYM.alm}`)

  const libro = nuevoLibroStock()
  const out: IncidenciaRebaja[] = []
  for (const inc of incidencias) {
    const [rows, members] = await Promise.all([getResumenProyecto(inc.id), adminRepo.listMembers(inc.id)])
    const calculadas = await calcularLineasRebaja({ rows, materiales, bodegaId: bodega.id, libro })
    out.push({
      projectId: inc.id,
      codigo: inc.codigo,
      tecnico: members.map((m) => m.nombre?.trim() || m.email || '').filter(Boolean).join(' / '),
      rut: members.map((m) => m.rut?.trim() || '').filter(Boolean).join(' / '),
      ingeniero: inc.ingeniero,
      lineas: calculadas.map((c) => ({
        localId: nanoid(8), materialId: c.materialId, sku: c.materialSku, descripcion: c.materialDescripcion,
        lote: c.lote, cantidad: String(c.cantidad), bodegaId: c.ubicacionBodegaId,
      })),
    })
  }
  return out
}

// ── Tablas ────────────────────────────────────────────────────────────────────

export interface FilaResumen { sku: string; descripcion: string; lote: string; cantidad: number }

/** Suma por SKU+lote entre todas las incidencias (solo líneas con cantidad > 0), ordenado por SKU y lote. */
export function resumenPorSkuLote(items: IncidenciaRebaja[]): FilaResumen[] {
  const acc = new Map<string, FilaResumen>()
  for (const it of items) {
    for (const l of it.lineas) {
      const n = Number(l.cantidad)
      if (!(n > 0)) continue
      const k = `${l.sku}|${l.lote}`
      const fila = acc.get(k) ?? { sku: l.sku, descripcion: l.descripcion, lote: l.lote, cantidad: 0 }
      fila.cantidad = Math.round((fila.cantidad + n) * 100) / 100
      acc.set(k, fila)
    }
  }
  return [...acc.values()].sort((a, b) =>
    a.sku.localeCompare(b.sku, undefined, { numeric: true }) || a.lote.localeCompare(b.lote, undefined, { numeric: true }))
}

export interface CorreoRebaja {
  to: string
  cc: string
  asunto: string
  responsableNombre: string
  responsableEmail: string
  firmaNombre: string
  firmaCargo: string
  items: IncidenciaRebaja[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const TD = 'border:1px solid #999;padding:2px 6px;'
const TH = `${TD}background:#d9d9d9;font-weight:bold;text-align:left;`

function tablaHtml(cabeceras: string[], filas: string[][]): string {
  const head = `<tr>${cabeceras.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('')}</tr>`
  const body = filas.map((f) => `<tr>${f.map((c) => `<td style="${TD}">${esc(c)}</td>`).join('')}</tr>`).join('')
  return `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;">${head}${body}</table>`
}

const filasResumen = (items: IncidenciaRebaja[]) =>
  resumenPorSkuLote(items).map((f) => [f.sku, f.descripcion, f.lote, REBAJA_OYM.alm, REBAJA_OYM.ceco, String(f.cantidad), REBAJA_OYM.retira])

const filasDetalle = (items: IncidenciaRebaja[]) =>
  items.flatMap((it) =>
    it.lineas.filter((l) => Number(l.cantidad) > 0).map((l) => [
      it.codigo, [it.tecnico, it.ingeniero].filter(Boolean).join(' // '), it.rut, l.sku, l.descripcion, l.lote, l.cantidad,
    ]))

const CAB_RESUMEN = ['SKU', 'DESCRIPCIÓN', 'LOTE', 'ALM', 'CECO', 'CANTIDAD', 'RETIRA']
const CAB_DETALLE = ['INCIDENCIA', 'Nombre técnico // Nombre ingeniero', 'RUT', 'Material', 'Descripción', 'Lote', 'Cantidad']

function textoIntro(c: CorreoRebaja): string {
  return `Estimados Mesa de Ayuda por favor su ayuda con generar una nueva INC, con el fin de regularizar todos los materiales utilizados en las INC indicadas al final del correo, con estatus cerrado y asignar como responsable a ${c.responsableNombre}.`
}

/** Cuerpo del correo en HTML (las dos tablas incluidas) — lo que se pega en Outlook o va dentro del .eml. */
export function correoHtml(c: CorreoRebaja): string {
  const firma = [c.firmaNombre, c.firmaCargo].filter(Boolean).map(esc).join('<br>')
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">
<p>${esc(textoIntro(c))}</p>
<p>${esc(c.responsableNombre)} ${esc(c.responsableEmail)}</p>
${tablaHtml(CAB_RESUMEN, filasResumen(c.items))}
<p>Lista de incidencias asociadas al uso de material:</p>
${tablaHtml(CAB_DETALLE, filasDetalle(c.items))}
<p>Quedo pendiente a su respuesta y comentarios. Saludos.</p>
<p>${firma}</p>
</div>`
}

export function correoTexto(c: CorreoRebaja): string {
  const linea = (f: string[]) => f.join(' | ')
  return [
    textoIntro(c),
    `${c.responsableNombre} ${c.responsableEmail}`,
    '',
    linea(CAB_RESUMEN),
    ...filasResumen(c.items).map(linea),
    '',
    'Lista de incidencias asociadas al uso de material:',
    '',
    linea(CAB_DETALLE),
    ...filasDetalle(c.items).map(linea),
    '',
    'Quedo pendiente a su respuesta y comentarios. Saludos.',
    '',
    [c.firmaNombre, c.firmaCargo].filter(Boolean).join('\n'),
  ].join('\n')
}

// ── .eml (borrador) ──────────────────────────────────────────────────────────

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const plegar = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join('\r\n')
const direcciones = (s: string) => s.split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).join(', ')
// eslint-disable-next-line no-control-regex
const esAscii = (s: string) => !/[^\x00-\x7f]/.test(s)

/**
 * Borrador de correo (.eml) listo para abrir en Outlook: `X-Unsent: 1` lo abre
 * como mensaje nuevo editable, con destinatarios, asunto y tablas ya cargados.
 */
export function construirEml(c: CorreoRebaja): string {
  const limite = `----=_Rebaja_${nanoid(12)}`
  const asunto = esAscii(c.asunto) ? c.asunto : `=?UTF-8?B?${b64Utf8(c.asunto)}?=`
  return [
    'X-Unsent: 1',
    `To: ${direcciones(c.to)}`,
    ...(direcciones(c.cc) ? [`Cc: ${direcciones(c.cc)}`] : []),
    `Subject: ${asunto}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    plegar(b64Utf8(correoTexto(c))),
    `--${limite}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    plegar(b64Utf8(correoHtml(c))),
    `--${limite}--`,
    '',
  ].join('\r\n')
}

export function descargarEml(c: CorreoRebaja, nombreArchivo: string): void {
  const url = URL.createObjectURL(new Blob([construirEml(c)], { type: 'message/rfc822' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copia el cuerpo como HTML (con las tablas) para pegarlo directo en un correo; cae a texto plano si el navegador no soporta HTML en el portapapeles. */
export async function copiarCorreoHtml(c: CorreoRebaja): Promise<void> {
  const html = correoHtml(c)
  const texto = correoTexto(c)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([texto], { type: 'text/plain' }),
    })])
    return
  }
  await navigator.clipboard.writeText(texto)
}

// ── Registro en el sistema ───────────────────────────────────────────────────

export interface ResultadoRegistroMasivo {
  /** localId de las líneas ya registradas (se descartan de la pantalla). */
  registradas: string[]
  errores: Record<string, string>
}

/** Registra un `rebajado` por línea (descuenta stock digital de la bodega). Las líneas con error se conservan para reintentar. */
export async function registrarRebajaMasiva(items: IncidenciaRebaja[], tecnicoUserId: string): Promise<ResultadoRegistroMasivo> {
  const res: ResultadoRegistroMasivo = { registradas: [], errores: {} }
  for (const it of items) {
    for (const l of it.lineas) {
      const n = Number(l.cantidad)
      if (!(n > 0)) continue
      try {
        await registrarMovimiento({
          tipoUI: 'rebajado', materialId: l.materialId, cantidad: n,
          lote: l.lote.trim() || undefined, projectId: it.projectId, ubicacionBodegaId: l.bodegaId,
          tecnicoUserId,
        })
        res.registradas.push(l.localId)
      } catch (err) {
        res.errores[l.localId] = err instanceof Error ? err.message : String(err)
      }
    }
  }
  return res
}
