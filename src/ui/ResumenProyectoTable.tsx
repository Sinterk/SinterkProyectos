// Resumen de material de un proyecto (solicitado/entregado/instalado/
// devuelto/rebajado/tránsito), como tabla con columnas fijas, editable por
// suma: cada celda editable registra un movimiento real (mismo camino que
// "Registrar movimiento" — atómico, respeta stock) en vez de sobreescribir
// el número directamente, así nunca se desincroniza del stock real. Por eso
// solo admite sumar cantidades, nunca restar: para corregir un exceso hay
// que registrar el movimiento contrario (ej. un Devuelto deshace una
// Entrega) — la función de la BD no permite cantidades negativas. Un solo
// clic en "Guardar cambios" registra todas las celdas editadas de una vez,
// una llamada (un movimiento) por celda.

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import { BODEGA_DEFECTO_POR_AREA } from '@/lib/inventario/defaults'
import {
  corregirProyectoMaterial, getResumenProyecto, listUbicaciones, reasignarTransitoAPreventivo, registrarMovimiento,
} from '@/lib/inventario/inventarioRepo'
import type { CampoCorregible } from '@/lib/inventario/inventarioRepo'
import type { MovimientoTipoUI, ResumenMaterialProyecto, Ubicacion } from '@/lib/inventario/types'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  area: 'ATT' | 'OyM'
  /** Solo se pasa para Preventivos: habilita el desglose "· <nombre del punto>" por fila. */
  puntos?: Punto[]
  refreshKey?: number
}

export function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className={`text-sm font-semibold ${highlight ? 'text-amber-400' : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  )
}

type Campo = 'cantSolicitada' | 'cantEntregada' | 'cantInstalada' | 'cantDevuelta' | 'cantRebajada'
const CAMPOS: Campo[] = ['cantSolicitada', 'cantEntregada', 'cantInstalada', 'cantDevuelta', 'cantRebajada']
const CAMPO_TIPO: Record<Campo, MovimientoTipoUI> = {
  cantSolicitada: 'solicitud', cantEntregada: 'entrega', cantInstalada: 'instalado',
  cantDevuelta: 'devuelto', cantRebajada: 'rebajado',
}
/** Campos cuyo movimiento requiere elegir bodega (origen para Entrega/Rebajado, destino para Devuelto). */
const CAMPO_NECESITA_BODEGA: Campo[] = ['cantEntregada', 'cantDevuelta', 'cantRebajada']
/** Campos corregibles directo (viven como columna propia en proyecto_materiales). Solicitado queda afuera: es un cálculo (suma de movimientos tipo='solicitud'), no una columna. */
const CAMPO_DB: Partial<Record<Campo, CampoCorregible>> = {
  cantEntregada: 'cant_entregada', cantInstalada: 'cant_instalada',
  cantDevuelta: 'cant_devuelta', cantRebajada: 'cant_rebajada',
}

export function ResumenProyectoTable({ projectId, area, puntos, refreshKey = 0 }: Props) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeCorregir = rol === 'admin' || rol === 'jp' || rol === 'log'
  // El técnico solo reporta lo que instaló/devolvió — entregado/rebajado los
  // registra oficina (entrega física, rebaja SAP), y solicitado no es un
  // campo propio (se calcula solo). Candado de UI, no de RLS: la función
  // registrar_movimiento ya autoriza al técnico para cualquier tipoUI sobre
  // sus propios proyectos, igual que otros candados de este estilo en la app
  // (ver "auto-democión" del admin en AdminScreen/UserRow).
  const editableCampos: Campo[] = rol === 'tecnico' ? ['cantInstalada', 'cantDevuelta'] : CAMPOS
  const [rows, setRows] = useState<ResumenMaterialProyecto[] | null>(null)
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  const [error, setError] = useState<string | null>(null)

  const [reassignKey, setReassignKey] = useState<string | null>(null)
  const [reassignTecnico, setReassignTecnico] = useState('')
  const [reassignCantidad, setReassignCantidad] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignMsg, setReassignMsg] = useState<string | null>(null)

  // Edición por suma: `edits[rowKey][campo]` = cantidad a agregar, tecleada pero aún sin guardar.
  const [edits, setEdits] = useState<Record<string, Partial<Record<Campo, string>>>>({})
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({}) // key = `${rowKey}|${campo}`
  const [tecnicoEdicion, setTecnicoEdicion] = useState('')
  const [bodegaEdicion, setBodegaEdicion] = useState('')
  const [saving, setSaving] = useState(false)

  // Modo corrección: sobreescribe el valor absoluto sin generar movimiento
  // ni tocar stock — solo para arreglar un error de tipeo. `corrections`
  // guarda el valor tecleado (no el delta); se compara contra el valor
  // actual de la fila al guardar para saltar las celdas sin cambios.
  const [modoCorreccion, setModoCorreccion] = useState(false)
  const [corrections, setCorrections] = useState<Record<string, Partial<Record<Campo, string>>>>({})
  const [correctionErrors, setCorrectionErrors] = useState<Record<string, string>>({})
  const [correcting, setCorrecting] = useState(false)

  async function reload() {
    try { setRows(await getResumenProyecto(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { setRows(null); reload() }, [projectId, refreshKey])
  useEffect(() => { adminRepo.listMembers(projectId).then(setMembers).catch(() => {}) }, [projectId])
  useEffect(() => { listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {}) }, [])

  useEffect(() => { if (!tecnicoEdicion && members.length > 0) setTecnicoEdicion(members[0].id) }, [members, tecnicoEdicion])
  const defaultBodegaId = bodegas.find((b) => b.nombre === BODEGA_DEFECTO_POR_AREA[area])?.id ?? ''
  useEffect(() => { if (!bodegaEdicion && defaultBodegaId) setBodegaEdicion(defaultBodegaId) }, [defaultBodegaId, bodegaEdicion])

  const puntoNombre = (id: string | null) => (id ? puntos?.find((p) => p.id === id)?.nombre ?? '—' : 'Sin punto específico')
  const rowKey = (r: ResumenMaterialProyecto) => `${r.materialId}|${r.lote}|${r.puntoId ?? ''}`

  function setDraft(key: string, campo: Campo, v: string) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: v } }))
  }

  const pendientes = Object.values(edits).flatMap((byCampo) =>
    Object.values(byCampo).filter((v) => v && Number(v) > 0))
  const hayPendientes = pendientes.length > 0

  async function guardarCambios() {
    if (!rows) return
    if (!tecnicoEdicion) { setError('Elige un técnico para registrar los movimientos'); return }
    setSaving(true)
    setError(null)
    const nextEdits: typeof edits = {}
    const nextErrors: Record<string, string> = {}
    for (const row of rows) {
      const key = rowKey(row)
      const byCampo = edits[key]
      if (!byCampo) continue
      for (const campo of CAMPOS) {
        const raw = byCampo[campo]
        const n = Number(raw)
        if (!raw || !(n > 0)) continue
        if (CAMPO_NECESITA_BODEGA.includes(campo) && !bodegaEdicion) {
          nextErrors[`${key}|${campo}`] = 'Falta elegir bodega'
          nextEdits[key] = { ...nextEdits[key], [campo]: raw }
          continue
        }
        try {
          await registrarMovimiento({
            tipoUI: CAMPO_TIPO[campo], materialId: row.materialId, cantidad: n, lote: row.lote,
            projectId, puntoId: row.puntoId, tecnicoUserId: tecnicoEdicion,
            ubicacionBodegaId: CAMPO_NECESITA_BODEGA.includes(campo) ? bodegaEdicion : undefined,
          })
        } catch (err) {
          nextErrors[`${key}|${campo}`] = err instanceof Error ? err.message : String(err)
          nextEdits[key] = { ...nextEdits[key], [campo]: raw }
        }
      }
    }
    setEdits(nextEdits)
    setCellErrors(nextErrors)
    setSaving(false)
    await reload()
  }

  function descartarCambios() {
    setEdits({})
    setCellErrors({})
  }

  function setCorrection(key: string, campo: Campo, v: string) {
    setCorrections((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: v } }))
  }

  const correccionesPendientes = rows
    ? rows.flatMap((row) => {
        const key = rowKey(row)
        const byCampo = corrections[key]
        if (!byCampo) return []
        return (Object.keys(byCampo) as Campo[])
          .filter((campo) => byCampo[campo] !== undefined && byCampo[campo] !== '' && Number(byCampo[campo]) !== row[campo])
      })
    : []
  const hayCorreccionesPendientes = correccionesPendientes.length > 0

  async function guardarCorrecciones() {
    if (!rows) return
    setCorrecting(true)
    setError(null)
    const nextCorrections: typeof corrections = {}
    const nextErrors: Record<string, string> = {}
    for (const row of rows) {
      const key = rowKey(row)
      const byCampo = corrections[key]
      if (!byCampo) continue
      for (const campo of Object.keys(byCampo) as Campo[]) {
        const raw = byCampo[campo]
        const dbCampo = CAMPO_DB[campo]
        if (raw === undefined || raw === '' || !dbCampo) continue
        const n = Number(raw)
        if (n === row[campo]) continue // sin cambio real, no molestar con una llamada de más
        if (!(n >= 0)) {
          nextErrors[`${key}|${campo}`] = 'Cantidad inválida'
          nextCorrections[key] = { ...nextCorrections[key], [campo]: raw }
          continue
        }
        try {
          await corregirProyectoMaterial({
            projectId, materialId: row.materialId, lote: row.lote, puntoId: row.puntoId, campo: dbCampo, valor: n,
          })
        } catch (err) {
          nextErrors[`${key}|${campo}`] = err instanceof Error ? err.message : String(err)
          nextCorrections[key] = { ...nextCorrections[key], [campo]: raw }
        }
      }
    }
    setCorrections(nextCorrections)
    setCorrectionErrors(nextErrors)
    setCorrecting(false)
    await reload()
  }

  function descartarCorrecciones() {
    setCorrections({})
    setCorrectionErrors({})
  }

  function startReassign(row: ResumenMaterialProyecto) {
    setReassignKey(rowKey(row))
    setReassignCantidad(String(row.cantTransito))
    setReassignTecnico(members[0]?.id ?? '')
    setReassignMsg(null)
  }

  async function confirmReassign(row: ResumenMaterialProyecto) {
    if (!reassignTecnico) { setReassignMsg('Elige un técnico'); return }
    const cantidad = Number(reassignCantidad)
    if (!(cantidad > 0)) { setReassignMsg('Cantidad inválida'); return }
    setReassignBusy(true)
    setReassignMsg(null)
    try {
      await reasignarTransitoAPreventivo({
        projectId, materialId: row.materialId, lote: row.lote, puntoId: row.puntoId,
        tecnicoUserId: reassignTecnico, cantidad,
      })
      setReassignKey(null)
      await reload()
    } catch (err) {
      setReassignMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setReassignBusy(false)
    }
  }

  const selectCls = 'bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none'

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material</h2>
        {puedeCorregir && rows && rows.length > 0 && (
          <button type="button"
            onClick={() => { setModoCorreccion((v) => !v); descartarCorrecciones() }}
            className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${modoCorreccion ? 'bg-amber-600 text-white' : 'text-amber-400 hover:bg-slate-700'}`}>
            🔧 {modoCorreccion ? 'Salir de corrección' : 'Corregir errores de tipeo'}
          </button>
        )}
      </div>
      {modoCorreccion && (
        <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg p-2">
          Esto sobreescribe el número directo, sin registrar un movimiento ni tocar el stock físico/digital de la
          bodega. Úsalo solo para arreglar un error de tipeo (ej. escribiste 15 en vez de 5) — si el número está mal
          porque realmente se entregó/instaló/devolvió/rebajó una cantidad distinta, no lo corrijas acá: usa el "+"
          normal o el formulario de abajo, así queda el movimiento real registrado. <strong>Solicitado</strong> no
          se puede corregir así, porque no es un valor propio — se calcula sumando los movimientos de Solicitud.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {rows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sin movimientos de material todavía.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                  <th className="px-2 py-2 font-medium whitespace-nowrap">SKU</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Lote</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Solicitado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Entregado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Instalado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Devuelto</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Rebajado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Tránsito</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = rowKey(row)
                  const draft = edits[key] ?? {}
                  const correctionDraft = corrections[key] ?? {}
                  return (
                    <tr key={key} className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{row.materialSku}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                        {row.lote}
                        {puntos && <p className="text-[10px] text-slate-500">{puntoNombre(row.puntoId)}</p>}
                      </td>
                      {CAMPOS.map((campo) => {
                        const valor = row[campo]
                        const esCorregible = modoCorreccion && CAMPO_DB[campo] !== undefined
                        if (esCorregible) {
                          const err = correctionErrors[`${key}|${campo}`]
                          return (
                            <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-slate-500 text-[10px]">=</span>
                                <input type="number" min="0" step="any" value={correctionDraft[campo] ?? String(valor)}
                                  onChange={(e) => setCorrection(key, campo, e.target.value)}
                                  className="w-12 bg-amber-950/30 text-amber-200 text-xs rounded px-1 py-0.5 border border-amber-700/60 focus:border-amber-500 focus:outline-none text-center" />
                              </div>
                              {err && <p className="text-[9px] text-red-400 mt-0.5">{err}</p>}
                            </td>
                          )
                        }
                        if (!editableCampos.includes(campo)) {
                          return (
                            <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                              <span className="text-white font-medium">{valor}</span>
                            </td>
                          )
                        }
                        const err = cellErrors[`${key}|${campo}`]
                        return (
                          <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-white font-medium">{valor}</span>
                              <span className="text-slate-500 text-[10px]">+</span>
                              <input type="number" min="0" step="any" placeholder="0" value={draft[campo] ?? ''}
                                onChange={(e) => setDraft(key, campo, e.target.value)}
                                className="w-12 bg-slate-700 text-white text-xs rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none text-center" />
                            </div>
                            {err && <p className="text-[9px] text-red-400 mt-0.5">{err}</p>}
                          </td>
                        )
                      })}
                      <td className={`px-2 py-2 text-center font-semibold whitespace-nowrap ${row.cantTransito > 0 ? 'text-amber-400' : 'text-white'}`}>
                        {row.cantTransito}
                        {row.cantTransito > 0 && (
                          reassignKey === key ? (
                            <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                              <select value={reassignTecnico} onChange={(e) => setReassignTecnico(e.target.value)} className={selectCls}>
                                <option value="">Técnico…</option>
                                {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
                              </select>
                              <input type="number" min="0" step="any" value={reassignCantidad}
                                onChange={(e) => setReassignCantidad(e.target.value)}
                                className="w-16 bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                              <button type="button" disabled={reassignBusy} onClick={() => confirmReassign(row)}
                                className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
                                OK
                              </button>
                              <button type="button" onClick={() => setReassignKey(null)} className="text-[10px] text-slate-400">✕</button>
                              {reassignMsg && <p className="text-[9px] text-red-400 w-full">{reassignMsg}</p>}
                            </div>
                          ) : (
                            <button type="button" onClick={() => startReassign(row)}
                              className="block mx-auto mt-1 text-[9px] text-amber-400 font-semibold underline decoration-dotted">
                              → preventivo
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {hayPendientes && (
            <div className="bg-slate-700/40 rounded-xl border border-dashed border-slate-600 p-3 space-y-2">
              <p className="text-[11px] text-slate-400">
                Cada "+" tecleado se registra como su propio movimiento (igual que abajo en "Registrar movimiento") —
                no se puede restar directamente; para corregir un exceso, registra el movimiento contrario
                (ej. un Devuelto deshace una Entrega).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select value={tecnicoEdicion} onChange={(e) => setTecnicoEdicion(e.target.value)} className={selectCls}>
                  <option value="">Técnico…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
                </select>
                <select value={bodegaEdicion} onChange={(e) => setBodegaEdicion(e.target.value)} className={selectCls}>
                  <option value="">Bodega…</option>
                  {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </select>
                <button type="button" disabled={saving} onClick={guardarCambios}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
                  {saving ? 'Guardando…' : `Guardar cambios (${pendientes.length})`}
                </button>
                <button type="button" disabled={saving} onClick={descartarCambios} className="text-xs text-slate-400">
                  Descartar
                </button>
              </div>
            </div>
          )}

          {hayCorreccionesPendientes && (
            <div className="bg-amber-950/30 rounded-xl border border-dashed border-amber-800/60 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={correcting} onClick={guardarCorrecciones}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40">
                  {correcting ? 'Guardando…' : `Guardar corrección (${correccionesPendientes.length})`}
                </button>
                <button type="button" disabled={correcting} onClick={descartarCorrecciones} className="text-xs text-slate-400">
                  Descartar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
