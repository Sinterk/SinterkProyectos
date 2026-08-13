// "Asignaciones" — rediseño del antiguo lado "Salida" de Entradas/Salidas →
// Registro (pedido explícito de Andrés, 05-08-2026); hoy vive en
// Inventario → Registro → Asignaciones. A diferencia del
// formulario compartido `RegistrarMovimientoForm` (que sigue igual para
// Entrada y para las pestañas Logística de ATT/Preventivos), acá ya no se
// asigna material a un proyecto específico — solo a un técnico. Tres tipos:
//
// - Entrega: bodega → técnico (resta bodega, suma técnico).
// - Conteo: igual que Entrega pero sin restar de la bodega — se asume que la
//   salida física ya ocurrió y solo faltaba quedar registrada en el sistema
//   (tipoUI 'conteo' en registrar_movimiento, ver 0047_conteo_asignacion.sql).
// - Devolución: muestra en una tabla lo que el stock real del técnico dice
//   que tiene asignado, con un campo "a devolver" por fila. Si se pide
//   devolver más de lo asignado, primero se registra un Conteo por la
//   diferencia y después la Devolución completa, para que el técnico quede
//   en 0 en ese material/lote (no en negativo).
//
// Como ya no hay Proyecto/OTT que sirva de referencia, cada movimiento se
// etiqueta automáticamente en el campo "N° documento" (antes libre, ahora
// calculado) con el tipo + la fecha — ver `documentoAuto`.

import { Fragment, useEffect, useState } from 'react'
import { nanoid } from '@/core/utils/nanoid'
import { adminRepo } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { listMateriales, listUbicaciones, getStock, registrarMovimiento } from '@/lib/inventario/inventarioRepo'
import type { Material, Ubicacion, StockRow } from '@/lib/inventario/types'
import { LoteSelect } from '@/ui/LoteSelect'
import { MaterialSelect } from '@/ui/MaterialSelect'
import { UbicacionSelect } from '@/ui/UbicacionSelect'

type AsigTipo = 'entrega' | 'devolucion' | 'conteo'

const TIPO_LABELS: Record<AsigTipo, string> = {
  entrega: 'Entrega', devolucion: 'Devolución', conteo: 'Conteo',
}

interface Linea {
  localId: string
  materialId: string
  cantidad: string
  lote: string
  ubicacionBodegaId: string
}

function emptyLinea(): Linea {
  return { localId: nanoid(8), materialId: '', cantidad: '', lote: '', ubicacionBodegaId: '' }
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** dd-mm-aaaa a partir de un <input type="date"> (aaaa-mm-dd). */
function fechaCorta(fechaISODate: string): string {
  const [y, m, d] = fechaISODate.split('-')
  return `${d}-${m}-${y}`
}

const inputCls = 'bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
const labelCls = 'text-[11px] text-slate-400'

export function AsignacionesForm({ onRegistered }: { onRegistered?: () => void }) {
  const [tipo, setTipo] = useState<AsigTipo>('entrega')
  const [materiales, setMateriales] = useState<Material[]>([])
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [ubicacionesTecnico, setUbicacionesTecnico] = useState<Ubicacion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [tecnicoUserId, setTecnicoUserId] = useState('')
  const [fecha, setFecha] = useState(todayISODate())
  const [nota, setNota] = useState('')

  // Entrega / Conteo
  const [lineas, setLineas] = useState<Linea[]>([emptyLinea()])
  const [submitting, setSubmitting] = useState(false)
  const [resultados, setResultados] = useState<Record<string, { ok: boolean; texto: string }>>({})

  // Devolución
  const [bodegaDestinoId, setBodegaDestinoId] = useState('')
  const [stockTecnico, setStockTecnico] = useState<StockRow[] | null>(null)
  const [aDevolver, setADevolver] = useState<Record<string, string>>({})
  const [devError, setDevError] = useState<string | null>(null)
  const [devSubmitting, setDevSubmitting] = useState(false)
  const [devResultados, setDevResultados] = useState<Record<string, { ok: boolean; texto: string }>>({})

  useEffect(() => {
    listMateriales().then(setMateriales).catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
    listUbicaciones({ tipo: 'tecnico' }).then(setUbicacionesTecnico).catch(() => {})
    adminRepo.listProfiles()
      .then((all) => setTecnicos(all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log'))))
      .catch(() => {})
  }, [])

  const tecnicoUbicacionId = tecnicoUserId
    ? ubicacionesTecnico.find((u) => u.ownerUserId === tecnicoUserId)?.id ?? null
    : null

  function reloadStockTecnico() {
    if (!tecnicoUbicacionId) { setStockTecnico(null); return }
    getStock({ ubicacionId: tecnicoUbicacionId })
      .then((rows) => setStockTecnico(rows.filter((r) => r.cantidadFisico > 0)))
      .catch((err) => setDevError(err instanceof Error ? err.message : String(err)))
  }
  useEffect(() => {
    if (tipo !== 'devolucion') return
    setStockTecnico(null)
    setADevolver({})
    reloadStockTecnico()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, tecnicoUbicacionId])

  function documentoAuto(t: AsigTipo): string {
    const label = t === 'entrega' ? 'preventivos' : t === 'devolucion' ? 'Devolución' : 'Conteo'
    return `${label} (${fechaCorta(fecha)})`
  }

  function updateLinea(localId: string, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)))
  }
  function addLinea() {
    setLineas((prev) => [...prev, emptyLinea()])
  }
  function removeLinea(localId: string) {
    setLineas((prev) => (prev.length > 1 ? prev.filter((l) => l.localId !== localId) : prev))
  }

  function validarLineas(): string | null {
    if (!tecnicoUserId) return 'Falta elegir el técnico'
    for (const l of lineas) {
      if (!l.materialId) return 'Falta elegir material en alguna línea'
      const n = Number(l.cantidad)
      if (!l.cantidad || !(n > 0)) return 'Cantidad inválida en alguna línea'
      if (!l.ubicacionBodegaId) return 'Falta la bodega en alguna línea'
    }
    return null
  }

  async function submitEntregaOConteo() {
    const err = validarLineas()
    if (err) { setResultados({ __general__: { ok: false, texto: err } }); return }
    setSubmitting(true)
    setResultados({})
    const fechaISO = fecha ? new Date(fecha).toISOString() : undefined
    const documento = documentoAuto(tipo)

    const nuevos: Record<string, { ok: boolean; texto: string }> = {}
    const restantes: Linea[] = []
    for (const l of lineas) {
      try {
        await registrarMovimiento({
          tipoUI: tipo === 'entrega' ? 'entrega' : 'conteo',
          materialId: l.materialId,
          cantidad: Number(l.cantidad),
          lote: l.lote.trim() || undefined,
          fecha: fechaISO,
          nota: nota.trim() || undefined,
          documento,
          ubicacionBodegaId: l.ubicacionBodegaId,
          tecnicoUserId,
        })
        nuevos[l.localId] = { ok: true, texto: 'Registrado' }
      } catch (e) {
        nuevos[l.localId] = { ok: false, texto: e instanceof Error ? e.message : String(e) }
        restantes.push(l)
      }
    }
    setResultados(nuevos)
    setSubmitting(false)
    if (restantes.length === 0) {
      setLineas([emptyLinea()])
      onRegistered?.()
    } else {
      setLineas(restantes)
    }
  }

  async function submitDevolucion() {
    if (!tecnicoUserId) { setDevError('Falta elegir el técnico'); return }
    if (!bodegaDestinoId) { setDevError('Falta elegir la bodega de destino'); return }
    const filas = (stockTecnico ?? []).filter((r) => Number(aDevolver[`${r.materialId}|${r.lote}`] || 0) > 0)
    if (filas.length === 0) { setDevError('Ingresa alguna cantidad a devolver'); return }

    setDevError(null)
    setDevSubmitting(true)
    setDevResultados({})
    const fechaISO = fecha ? new Date(fecha).toISOString() : undefined

    const nuevos: Record<string, { ok: boolean; texto: string }> = {}
    for (const r of filas) {
      const key = `${r.materialId}|${r.lote}`
      const cantidadDevolver = Number(aDevolver[key])
      try {
        if (cantidadDevolver > r.cantidadFisico) {
          // Pide devolver más de lo que el sistema tiene asignado — se
          // asume que la entrega original no quedó registrada. Se
          // completa primero con un Conteo por la diferencia, para que
          // la Devolución de abajo deje al técnico exactamente en 0.
          await registrarMovimiento({
            tipoUI: 'conteo', materialId: r.materialId, cantidad: cantidadDevolver - r.cantidadFisico,
            lote: r.lote || undefined, fecha: fechaISO, nota: nota.trim() || undefined,
            documento: documentoAuto('conteo'), tecnicoUserId,
          })
        }
        await registrarMovimiento({
          tipoUI: 'devuelto', materialId: r.materialId, cantidad: cantidadDevolver,
          lote: r.lote || undefined, fecha: fechaISO, nota: nota.trim() || undefined,
          documento: documentoAuto('devolucion'), tecnicoUserId, ubicacionBodegaId: bodegaDestinoId,
        })
        nuevos[key] = { ok: true, texto: 'Devuelto' }
      } catch (e) {
        nuevos[key] = { ok: false, texto: e instanceof Error ? e.message : String(e) }
      }
    }
    setDevResultados(nuevos)
    setDevSubmitting(false)
    setADevolver({})
    reloadStockTecnico()
    onRegistered?.()
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-4">
      {loadError && <p className="text-xs text-red-400">{loadError}</p>}

      <div className="flex gap-2">
        {(['entrega', 'devolucion', 'conteo'] as AsigTipo[]).map((t) => (
          <button key={t} type="button" onClick={() => setTipo(t)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tipo === t ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            {TIPO_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 col-span-2">
          <span className={labelCls}>Técnico</span>
          <select value={tecnicoUserId} onChange={(e) => setTecnicoUserId(e.target.value)} className={`${inputCls} w-full`}>
            <option value="">Elegir técnico…</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre?.trim() || t.email}</option>)}
          </select>
        </label>
        {tipo === 'devolucion' && (
          <label className="space-y-1 col-span-2">
            <span className={labelCls}>Bodega destino</span>
            <UbicacionSelect value={bodegaDestinoId} onChange={setBodegaDestinoId} tipo="bodega"
              placeholder="Elegir bodega…" className={`${inputCls} w-full`} />
          </label>
        )}
        <label className="space-y-1">
          <span className={labelCls}>Fecha</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={`${inputCls} w-full`} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Nota</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className={`${inputCls} w-full`} />
        </label>
      </div>

      {tipo === 'devolucion' ? (
        <div className="space-y-2">
          <span className={labelCls}>Materiales asignados al técnico</span>
          {!tecnicoUserId ? (
            <p className="text-xs text-slate-500">Elige un técnico para ver lo que tiene asignado.</p>
          ) : stockTecnico === null ? (
            <p className="text-xs text-slate-500">Cargando…</p>
          ) : stockTecnico.length === 0 ? (
            <p className="text-xs text-slate-500">Este técnico no tiene materiales asignados.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 text-left divide-x divide-slate-700">
                    <th className="px-2 py-1.5">SKU</th>
                    <th className="px-2 py-1.5">Descripción</th>
                    <th className="px-2 py-1.5">Lote</th>
                    <th className="px-2 py-1.5 text-right">Asignado</th>
                    <th className="px-2 py-1.5 text-right">A devolver</th>
                  </tr>
                </thead>
                <tbody>
                  {stockTecnico.map((r) => {
                    const key = `${r.materialId}|${r.lote}`
                    const res = devResultados[key]
                    return (
                      <tr key={key} className="border-t border-slate-800">
                        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{r.materialSku}</td>
                        <td className="px-2 py-1.5 text-slate-300">{r.materialDescripcion}</td>
                        <td className="px-2 py-1.5 text-slate-400">{r.lote || '—'}</td>
                        <td className="px-2 py-1.5 text-right text-white">{r.cantidadFisico}</td>
                        <td className="px-2 py-1.5 text-right">
                          <input type="number" min="0" step="any" placeholder="0" value={aDevolver[key] ?? ''}
                            onChange={(e) => setADevolver((prev) => ({ ...prev, [key]: e.target.value }))}
                            className={`${inputCls} w-20 text-right`} />
                          {res && <p className={`mt-1 ${res.ok ? 'text-green-400' : 'text-red-400'}`}>{res.texto}</p>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {devError && <p className="text-xs text-red-400">{devError}</p>}
          <button type="button" onClick={submitDevolucion} disabled={devSubmitting}
            className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
            {devSubmitting ? 'Registrando…' : 'Registrar devolución'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <span className={labelCls}>Material</span>
          {/* Mismo formato de tabla que Devolución, que ya era así: una fila
              por línea, con las columnas alineadas entre sí. El scroll
              horizontal vive en este contenedor, no en la página. */}
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-400 text-left divide-x divide-slate-700">
                  <th className="px-2 py-1.5 font-medium">Material</th>
                  <th className="px-2 py-1.5 font-medium">Bodega</th>
                  <th className="px-2 py-1.5 font-medium">Lote</th>
                  <th className="px-2 py-1.5 font-medium text-right">Cantidad</th>
                  <th className="px-2 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const r = resultados[l.localId]
                  return (
                    <Fragment key={l.localId}>
                      <tr className="border-t border-slate-800 divide-x divide-slate-800">
                        <td className="px-2 py-1.5 min-w-[12rem]">
                          <MaterialSelect materiales={materiales} value={l.materialId}
                            onChange={(id) => updateLinea(l.localId, { materialId: id, lote: '' })} />
                        </td>
                        <td className="px-2 py-1.5 min-w-[10rem]">
                          <UbicacionSelect value={l.ubicacionBodegaId} onChange={(id) => updateLinea(l.localId, { ubicacionBodegaId: id, lote: '' })}
                            tipo="bodega" placeholder="Bodega de origen…" className={`${inputCls} w-full`} />
                        </td>
                        <td className="px-2 py-1.5 min-w-[9rem]">
                          {/* Recién acá se conoce la bodega: LoteSelect ya puede
                              mostrarse como desplegable con los lotes disponibles,
                              en vez de caer al campo de texto libre (mismo
                              comportamiento que en Logística/Registrar Movimiento). */}
                          <LoteSelect materialId={l.materialId} ubicacionId={l.ubicacionBodegaId || null} naturaleza="fisico"
                            checkAvailability={tipo === 'entrega'} value={l.lote}
                            onChange={(lote) => updateLinea(l.localId, { lote })} className={`${inputCls} w-full`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="any" placeholder="0" value={l.cantidad}
                            onChange={(e) => updateLinea(l.localId, { cantidad: e.target.value })}
                            className={`${inputCls} w-20 text-right`} />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button type="button" onClick={() => removeLinea(l.localId)} disabled={lineas.length === 1}
                            className="text-xs text-red-400 disabled:opacity-30">Quitar</button>
                        </td>
                      </tr>
                      {r && (
                        <tr className="border-t border-slate-800">
                          <td colSpan={5} className={`px-2 pb-1.5 text-xs ${r.ok ? 'text-green-400' : 'text-red-400'}`}>{r.texto}</td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addLinea} className="text-xs text-brand-400 font-semibold">+ Agregar línea</button>
          {resultados.__general__ && <p className="text-xs text-red-400">{resultados.__general__.texto}</p>}
          <button type="button" onClick={submitEntregaOConteo} disabled={submitting}
            className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
            {submitting ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      )}
    </div>
  )
}
