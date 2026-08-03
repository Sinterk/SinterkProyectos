// Pantalla de Estado de Pago (EP) por OTT — ver src/lib/ep/*, punto 19 de
// docs/CONTINUAR-BACKEND.md. El avance sugerido (origen 'auto') se recalcula
// en vivo con el botón "Regenerar avance"; el JP ajusta cantidades/precios,
// agrega líneas manuales si hace falta, y recién con "Guardar" queda escrito
// en `ep_lineas`. Solo admin/jp/log (misma RLS que el resto de Logística).

import { useEffect, useMemo, useState } from 'react'
import { calcularAvanceEp, getOrCrearEpInforme, guardarEpLineas, listEpLineas, actualizarZonaEpInforme } from '@/lib/ep/epRepo'
import type { EpLineaInput, EpLineaOrigen } from '@/lib/ep/types'
import { listLpuCodigos, listZonasLpu } from '@/lib/lpu/lpuRepo'
import type { LpuCodigo } from '@/lib/lpu/types'
import { LpuCodigoSelect } from '@/ui/LpuCodigoSelect'

interface Props {
  projectId: string
  tramos: { tipoCable: string; metraje: string }[]
}

/** Fila editable en pantalla — igual que EpLineaInput, con una key estable para React (las guardadas no la tienen, se genera acá). */
interface FilaEp extends EpLineaInput {
  key: string
}

let nextKey = 0
function keyFrom(base: string) { nextKey += 1; return `${base}-${nextKey}` }

const inputCls = 'w-full bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'

export function EstadoPagoTab({ projectId, tramos }: Props) {
  const [epInformeId, setEpInformeId] = useState<string | null>(null)
  const [zona, setZona] = useState('RM-CENTRO')
  const [zonas, setZonas] = useState<string[]>([])
  const [codigos, setCodigos] = useState<LpuCodigo[]>([])
  const [filas, setFilas] = useState<FilaEp[] | null>(null)
  const [nuevoCodigoId, setNuevoCodigoId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const [informe, zs, cs] = await Promise.all([getOrCrearEpInforme(projectId), listZonasLpu(), listLpuCodigos()])
        setEpInformeId(informe.id)
        setZona(informe.zona ?? 'RM-CENTRO')
        setZonas(zs)
        setCodigos(cs)
        const lineas = await listEpLineas(informe.id)
        setFilas(lineas.map((l) => ({ key: keyFrom('db'), lpuCodigoId: l.lpuCodigoId, codigoAtt: l.codigoAtt, descripcion: l.descripcion, unidad: l.unidad, precioUnitario: l.precioUnitario, cantidad: l.cantidad, observaciones: l.observaciones, origen: l.origen })))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function cambiarZona(nueva: string) {
    setZona(nueva)
    if (epInformeId) await actualizarZonaEpInforme(epInformeId, nueva).catch(() => {})
  }

  async function regenerarAvance() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const sugeridas = await calcularAvanceEp(projectId, zona, tramos)
      setFilas((prev) => {
        const manuales = (prev ?? []).filter((f) => f.origen === 'manual')
        const auto: FilaEp[] = sugeridas.map((s) => ({
          key: keyFrom('auto'), lpuCodigoId: s.lpuCodigoId, codigoAtt: s.codigoAtt, descripcion: s.descripcion,
          unidad: s.unidad, precioUnitario: s.precioUnitario, cantidad: s.cantidad, observaciones: null, origen: 'auto' as EpLineaOrigen,
        }))
        return [...auto, ...manuales]
      })
      setMsg(`Avance recalculado: ${sugeridas.length} línea(s) sugerida(s) (materiales + tendido). Revisa y ajusta antes de guardar.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function agregarLineaManual() {
    const codigo = codigos.find((c) => c.id === nuevoCodigoId)
    if (!codigo) return
    setFilas((prev) => [...(prev ?? []), {
      key: keyFrom('manual'), lpuCodigoId: codigo.id, codigoAtt: codigo.codigoAtt,
      descripcion: codigo.partida || codigo.descripcion, unidad: codigo.unidad, precioUnitario: 0,
      cantidad: 0, observaciones: null, origen: 'manual',
    }])
    setNuevoCodigoId('')
  }

  function actualizarFila(key: string, cambios: Partial<FilaEp>) {
    setFilas((prev) => (prev ?? []).map((f) => (f.key === key ? { ...f, ...cambios } : f)))
  }

  function quitarFila(key: string) {
    setFilas((prev) => (prev ?? []).filter((f) => f.key !== key))
  }

  async function guardar() {
    if (!epInformeId || !filas) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      await guardarEpLineas(epInformeId, filas)
      setMsg('Guardado.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function copiarParaExcel() {
    const filasTexto = (filas ?? [])
      .map((f) => [f.codigoAtt, f.descripcion, f.unidad ?? '', f.cantidad, f.precioUnitario, f.cantidad * f.precioUnitario].join('\t'))
      .join('\n')
    navigator.clipboard.writeText(filasTexto)
      .then(() => setMsg('Copiado — pega en la pestaña del Excel real.'))
      .catch(() => setError('No se pudo copiar al portapapeles.'))
  }

  const total = useMemo(() => (filas ?? []).reduce((sum, f) => sum + f.cantidad * f.precioUnitario, 0), [filas])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400 shrink-0">Zona LPU</label>
        <select value={zona} onChange={(e) => cambiarZona(e.target.value)} className={`${inputCls} w-auto`}>
          {!zonas.includes(zona) && <option value={zona}>{zona}</option>}
          {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <button type="button" onClick={regenerarAvance} disabled={busy}
          className="ml-auto px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-semibold">
          {busy ? 'Calculando…' : '↻ Regenerar avance'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {msg && <p className="text-xs text-green-400">{msg}</p>}

      {filas === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                  <th className="px-2 py-1.5">Código ATT</th>
                  <th className="px-2 py-1.5">Descripción</th>
                  <th className="px-2 py-1.5">Unidad</th>
                  <th className="px-2 py-1.5 text-right">Cantidad</th>
                  <th className="px-2 py-1.5 text-right">Precio unit.</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5">Origen</th>
                  <th className="px-2 py-1.5">Observaciones</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr><td colSpan={9} className="px-2 py-3 text-center text-slate-500">
                    Sin líneas todavía — usa "Regenerar avance" o agrega una manual abajo.
                  </td></tr>
                )}
                {filas.map((f) => (
                  <tr key={f.key} className="border-t border-slate-800">
                    <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{f.codigoAtt}</td>
                    <td className="px-2 py-1.5 text-slate-300">{f.descripcion}</td>
                    <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{f.unidad ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="any" value={f.cantidad}
                        onChange={(e) => actualizarFila(f.key, { cantidad: Number(e.target.value) })}
                        className="w-20 bg-slate-700 text-white text-right rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="any" value={f.precioUnitario}
                        onChange={(e) => actualizarFila(f.key, { precioUnitario: Number(e.target.value) })}
                        className="w-24 bg-slate-700 text-white text-right rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                    </td>
                    <td className="px-2 py-1.5 text-right text-white font-medium whitespace-nowrap">
                      {(f.cantidad * f.precioUnitario).toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${f.origen === 'auto' ? 'bg-blue-900/50 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>
                        {f.origen === 'auto' ? 'Auto' : 'Manual'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={f.observaciones ?? ''} onChange={(e) => actualizarFila(f.key, { observaciones: e.target.value })}
                        placeholder="—" className="w-full bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => quitarFila(f.key)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filas.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-700 bg-slate-900/40">
                    <td colSpan={5} className="px-2 py-1.5 text-right text-slate-400 font-medium">Total</td>
                    <td className="px-2 py-1.5 text-right text-white font-bold whitespace-nowrap">
                      {total.toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="flex flex-wrap gap-1.5 items-center">
            <LpuCodigoSelect codigos={codigos} value={nuevoCodigoId} onChange={setNuevoCodigoId} className="flex-1 min-w-[200px]" />
            <button type="button" disabled={!nuevoCodigoId} onClick={agregarLineaManual}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-xs font-semibold">
              + Agregar línea manual
            </button>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={guardar} disabled={busy}
              className="flex-1 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
              {busy ? 'Guardando…' : '💾 Guardar'}
            </button>
            <button type="button" onClick={copiarParaExcel}
              className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold">
              📋 Copiar para Excel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
