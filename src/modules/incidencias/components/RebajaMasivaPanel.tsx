// Rebaja masiva de incidencias OyM (pedido de Andrés): se rebajan varias
// incidencias a la vez, una vez al mes aprox., y se pide a la Mesa de Ayuda de
// Entel con un correo de dos tablas (resumen por SKU+lote y detalle por
// incidencia). Ver src/lib/inventario/rebajaMasiva.ts.
//
// "Generar correo" (borrador .eml / copiar tablas) NO toca la base; "Registrar
// rebaja en el sistema" descuenta el stock digital — son pasos separados a
// propósito, para poder mandar el correo primero y registrar cuando Entel
// confirme.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  copiarCorreoHtml, descargarEml, prepararRebajaMasiva, REBAJA_OYM, registrarRebajaMasiva, resumenPorSkuLote,
  type CorreoRebaja, type IncidenciaRebaja,
} from '@/lib/inventario/rebajaMasiva'
import { etiquetaPreventivo, proyectoMaterialId, type Incidencia } from '../types'

const STORAGE_KEY = 'rebajaOymCorreo'
const DEFAULTS = {
  to: 'boletas.redes@f1.services, g_mared_ecc@entel.cl',
  cc: 'ser_gestionmant@entel.cl, boyarzo@entel.cl, fverdugo@entel.cl, pablina.segovia@f1.services, flor.rojas@f1.services, jrondon@sinterk.cl, czavalla@sinterk.cl, iperez@sinterk.cl',
  responsableNombre: 'González Henry',
  responsableEmail: 'ing_mantencion1@entel.cl',
}

function cargarConfig(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* sin storage: se usan los valores por defecto */ }
  return DEFAULTS
}

function fechaPunto(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

const inputCls = 'w-full bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
const labelCls = 'text-[10px] text-slate-400'

export function RebajaMasivaPanel({ incidencias, onClose }: { incidencias: Incidencia[]; onClose: () => void }) {
  const profile = useAuth((s) => s.profile)
  const [items, setItems] = useState<IncidenciaRebaja[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState(cargarConfig)
  const [asunto, setAsunto] = useState(`SOLICITUD DE ACTIVIDAD ERT - SINTERK ${fechaPunto()}`)
  const [registrando, setRegistrando] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  useEffect(() => {
    let cancelado = false
    // Una incidencia nacida de un cuadrante rebaja el material del cuadrante
    // (proyectoMaterialId): ahí viven sus movimientos, no en la incidencia.
    prepararRebajaMasiva(incidencias.map((i) => ({ id: proyectoMaterialId(i), codigo: i.codigo, ingeniero: i.ingeniero })))
      .then((r) => { if (!cancelado) setItems(r) })
      .catch((e) => { if (!cancelado) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelado = true }
    // Se calcula una sola vez al abrir: editar lotes a mano no debe recalcularse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function guardarConfig(next: typeof DEFAULTS) {
    setConfig(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* sin storage: no se recuerda */ }
  }
  function patchItem(projectId: string, patch: Partial<IncidenciaRebaja>) {
    setItems((prev) => prev?.map((it) => (it.projectId === projectId ? { ...it, ...patch } : it)) ?? prev)
  }
  function patchLinea(projectId: string, localId: string, patch: { lote?: string; cantidad?: string }) {
    setItems((prev) => prev?.map((it) => it.projectId !== projectId ? it
      : { ...it, lineas: it.lineas.map((l) => (l.localId === localId ? { ...l, ...patch } : l)) }) ?? prev)
  }
  function quitarLinea(projectId: string, localId: string) {
    setItems((prev) => prev?.map((it) => it.projectId !== projectId ? it
      : { ...it, lineas: it.lineas.filter((l) => l.localId !== localId) }) ?? prev)
  }

  const lineasActivas = useMemo(
    () => (items ?? []).flatMap((it) => it.lineas.filter((l) => Number(l.cantidad) > 0)),
    [items],
  )
  const sinLote = lineasActivas.filter((l) => !l.lote.trim()).length
  const resumen = useMemo(() => resumenPorSkuLote(items ?? []), [items])

  const correo: CorreoRebaja = {
    to: config.to, cc: config.cc, asunto,
    responsableNombre: config.responsableNombre, responsableEmail: config.responsableEmail,
    firmaNombre: profile?.nombre?.trim() || '', firmaCargo: profile?.cargo?.trim() || '',
    items: items ?? [],
  }
  // El correo pide el número de incidencia: si alguna con material todavía no
  // lo tiene (Entel no lo ha asignado), no se genera.
  const etiquetaDe = useMemo(
    () => new Map(incidencias.map((i) => [proyectoMaterialId(i), i.preventivo ? etiquetaPreventivo(i.preventivo) : ''])),
    [incidencias],
  )
  const sinNumero = (items ?? []).filter((it) => !it.codigo.trim() && it.lineas.some((l) => Number(l.cantidad) > 0))
  const puedeGenerar = lineasActivas.length > 0 && sinLote === 0
  const puedeCorreo = puedeGenerar && sinNumero.length === 0

  async function copiar() {
    setMsg(null)
    try {
      await copiarCorreoHtml(correo)
      setMsg({ ok: true, texto: 'Tablas copiadas — pégalas en un correo nuevo.' })
    } catch {
      setMsg({ ok: false, texto: 'No se pudo copiar al portapapeles.' })
    }
  }

  async function registrar() {
    if (!items || !profile) return
    if (!confirm(`Se registrarán ${lineasActivas.length} rebaja(s) en el sistema y se descontará el stock digital de ${REBAJA_OYM.alm}. ¿Continuar?`)) return
    setRegistrando(true)
    setMsg(null)
    try {
      const res = await registrarRebajaMasiva(items, profile.id)
      setErrores(res.errores)
      const hechas = new Set(res.registradas)
      setItems((prev) => prev?.map((it) => ({ ...it, lineas: it.lineas.filter((l) => !hechas.has(l.localId)) })) ?? prev)
      const fallidas = Object.keys(res.errores).length
      setMsg({
        ok: fallidas === 0,
        texto: fallidas === 0 ? `${res.registradas.length} rebaja(s) registradas.`
          : `${res.registradas.length} registradas, ${fallidas} con error (siguen en pantalla para reintentar).`,
      })
    } finally {
      setRegistrando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto p-2 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl mx-auto my-2 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">📦 Rebaja masiva OyM</h2>
            <p className="text-[11px] text-slate-400">
              {incidencias.length} incidencia(s) · ALM {REBAJA_OYM.alm} · CECO {REBAJA_OYM.ceco} · RETIRA {REBAJA_OYM.retira}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {!items && !error && <p className="text-xs text-slate-500">Calculando material pendiente de rebaja…</p>}

        {items && (
          <>
            <div className="space-y-3">
              {items.map((it) => (
                <div key={it.projectId} className="bg-slate-800 rounded-xl border border-slate-700 p-3 space-y-2">
                  <p className="text-sm font-semibold text-white">
                    {it.codigo
                      ? <>INC <span className="font-mono">{it.codigo}</span></>
                      : <span className="text-amber-400">Sin número de incidencia</span>}
                    {etiquetaDe.get(it.projectId) && <span className="ml-2 text-[11px] font-normal text-slate-400">🔗 {etiquetaDe.get(it.projectId)}</span>}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="space-y-0.5"><span className={labelCls}>Nombre técnico</span>
                      <input value={it.tecnico} onChange={(e) => patchItem(it.projectId, { tecnico: e.target.value })} className={inputCls} /></label>
                    <label className="space-y-0.5"><span className={labelCls}>Nombre ingeniero</span>
                      <input value={it.ingeniero} onChange={(e) => patchItem(it.projectId, { ingeniero: e.target.value })} className={inputCls} /></label>
                    <label className="space-y-0.5"><span className={labelCls}>RUT técnico</span>
                      <input value={it.rut} onChange={(e) => patchItem(it.projectId, { rut: e.target.value })} className={inputCls} /></label>
                  </div>
                  {it.lineas.length === 0 ? (
                    <p className="text-[11px] text-slate-500">Sin material pendiente de rebaja.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-700">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 text-left">
                            <th className="px-2 py-1">SKU</th><th className="px-2 py-1">Descripción</th>
                            <th className="px-2 py-1">Lote</th><th className="px-2 py-1 text-right">Cantidad</th><th />
                          </tr>
                        </thead>
                        <tbody>
                          {it.lineas.map((l) => (
                            <tr key={l.localId} className="border-t border-slate-800">
                              <td className="px-2 py-1 text-slate-300 whitespace-nowrap">{l.sku}</td>
                              <td className="px-2 py-1 text-slate-300">
                                {l.descripcion}
                                {errores[l.localId] && <p className="text-[10px] text-red-400">{errores[l.localId]}</p>}
                              </td>
                              <td className="px-2 py-1 min-w-[8rem]">
                                <input value={l.lote} placeholder="Sin stock — completar"
                                  onChange={(e) => patchLinea(it.projectId, l.localId, { lote: e.target.value })}
                                  className={`${inputCls} ${l.lote.trim() ? '' : 'border-red-500'}`} />
                              </td>
                              <td className="px-2 py-1 w-20">
                                <input type="number" min="0" step="any" value={l.cantidad}
                                  onChange={(e) => patchLinea(it.projectId, l.localId, { cantidad: e.target.value })}
                                  className={`${inputCls} text-right`} />
                              </td>
                              <td className="px-2 py-1">
                                <button type="button" onClick={() => quitarLinea(it.projectId, l.localId)}
                                  className="text-slate-500 hover:text-red-400 text-base leading-none">×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Resumen de material (primera tabla del correo)</p>
              {resumen.length === 0 ? (
                <p className="text-[11px] text-slate-500">Nada que rebajar.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-800 text-slate-400 text-left">
                        {['SKU', 'DESCRIPCIÓN', 'LOTE', 'ALM', 'CECO', 'CANTIDAD', 'RETIRA'].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {resumen.map((f) => (
                        <tr key={`${f.sku}|${f.lote}`} className="border-t border-slate-800 text-slate-300">
                          <td className="px-2 py-1">{f.sku}</td><td className="px-2 py-1">{f.descripcion}</td><td className="px-2 py-1">{f.lote}</td>
                          <td className="px-2 py-1">{REBAJA_OYM.alm}</td><td className="px-2 py-1">{REBAJA_OYM.ceco}</td>
                          <td className="px-2 py-1 text-right">{f.cantidad}</td><td className="px-2 py-1">{REBAJA_OYM.retira}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <details className="bg-slate-800 rounded-xl border border-slate-700 p-3">
              <summary className="text-xs font-semibold text-brand-400 cursor-pointer">Destinatarios y datos del correo</summary>
              <div className="grid grid-cols-1 gap-2 mt-3">
                <label className="space-y-0.5"><span className={labelCls}>Para</span>
                  <textarea rows={2} value={config.to} onChange={(e) => guardarConfig({ ...config, to: e.target.value })} className={inputCls} /></label>
                <label className="space-y-0.5"><span className={labelCls}>CC</span>
                  <textarea rows={3} value={config.cc} onChange={(e) => guardarConfig({ ...config, cc: e.target.value })} className={inputCls} /></label>
                <label className="space-y-0.5"><span className={labelCls}>Asunto</span>
                  <input value={asunto} onChange={(e) => setAsunto(e.target.value)} className={inputCls} /></label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="space-y-0.5"><span className={labelCls}>Responsable (nombre)</span>
                    <input value={config.responsableNombre} onChange={(e) => guardarConfig({ ...config, responsableNombre: e.target.value })} className={inputCls} /></label>
                  <label className="space-y-0.5"><span className={labelCls}>Responsable (correo)</span>
                    <input value={config.responsableEmail} onChange={(e) => guardarConfig({ ...config, responsableEmail: e.target.value })} className={inputCls} /></label>
                </div>
              </div>
            </details>

            {sinLote > 0 && (
              <p className="text-xs text-amber-400">
                {sinLote} línea(s) sin lote (no hay stock digital suficiente en {REBAJA_OYM.alm}) — complétalas o quítalas para generar el correo o registrar.
              </p>
            )}
            {sinNumero.length > 0 && (
              <p className="text-xs text-amber-400">
                {sinNumero.length} incidencia(s) con material todavía sin número de incidencia (Entel no la ha asignado) — el correo se genera cuando todas tengan número.
              </p>
            )}
            {msg && <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.texto}</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!puedeCorreo}
                onClick={() => descargarEml(correo, `Rebaja OyM - ${fechaPunto()}.eml`)}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-xl">
                📧 Descargar borrador (.eml)
              </button>
              <button type="button" disabled={!puedeCorreo} onClick={() => { copiar().catch(console.error) }}
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-xl">
                📋 Copiar tablas
              </button>
              <button type="button" disabled={!puedeGenerar || registrando} onClick={() => { registrar().catch(console.error) }}
                className="sm:ml-auto bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-xl">
                {registrando ? 'Registrando…' : '✅ Registrar rebaja en el sistema'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
