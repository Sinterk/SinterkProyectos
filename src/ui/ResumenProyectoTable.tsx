// Resumen de material de un proyecto (solicitado/entregado/instalado/
// devuelto/rebajado/tránsito) con acción de reasignar tránsito a preventivo.
// Compartido por la pestaña Logística (ATT/Preventivos, proyecto fijo) y la
// ventana Inventario → pestaña Proyecto (proyecto elegido por selector).

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import { getResumenProyecto, reasignarTransitoAPreventivo } from '@/lib/inventario/inventarioRepo'
import type { ResumenMaterialProyecto } from '@/lib/inventario/types'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
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

export function ResumenProyectoTable({ projectId, puntos, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<ResumenMaterialProyecto[] | null>(null)
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [error, setError] = useState<string | null>(null)

  const [reassignKey, setReassignKey] = useState<string | null>(null)
  const [reassignTecnico, setReassignTecnico] = useState('')
  const [reassignCantidad, setReassignCantidad] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignMsg, setReassignMsg] = useState<string | null>(null)

  async function reload() {
    try { setRows(await getResumenProyecto(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { setRows(null); reload() }, [projectId, refreshKey])
  useEffect(() => { adminRepo.listMembers(projectId).then(setMembers).catch(() => {}) }, [projectId])

  const puntoNombre = (id: string | null) => (id ? puntos?.find((p) => p.id === id)?.nombre ?? '—' : 'Sin punto específico')
  const rowKey = (r: ResumenMaterialProyecto) => `${r.materialId}|${r.lote}|${r.puntoId ?? ''}`

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

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {rows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sin movimientos de material todavía.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const key = rowKey(row)
            return (
              <div key={key} className="bg-slate-700/50 rounded-xl p-3 space-y-2">
                <div>
                  <p className="text-sm text-white">{row.materialSku} — {row.materialDescripcion}</p>
                  <p className="text-[11px] text-slate-500">Lote {row.lote}{puntos ? ` · ${puntoNombre(row.puntoId)}` : ''}</p>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
                  <Stat label="Solicit." value={row.cantSolicitada} />
                  <Stat label="Entreg." value={row.cantEntregada} />
                  <Stat label="Instal." value={row.cantInstalada} />
                  <Stat label="Devuelto" value={row.cantDevuelta} />
                  <Stat label="Rebajado" value={row.cantRebajada} />
                  <Stat label="Tránsito" value={row.cantTransito} highlight={row.cantTransito > 0} />
                </div>
                {row.cantTransito > 0 && (
                  reassignKey === key ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <select value={reassignTecnico} onChange={(e) => setReassignTecnico(e.target.value)}
                        className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                        <option value="">Técnico…</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
                      </select>
                      <input type="number" min="0" step="any" value={reassignCantidad}
                        onChange={(e) => setReassignCantidad(e.target.value)}
                        className="w-20 bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                      <button type="button" disabled={reassignBusy} onClick={() => confirmReassign(row)}
                        className="text-xs font-semibold px-2 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
                        Confirmar
                      </button>
                      <button type="button" onClick={() => setReassignKey(null)} className="text-xs text-slate-400">Cancelar</button>
                      {reassignMsg && <p className="text-xs text-red-400 w-full">{reassignMsg}</p>}
                    </div>
                  ) : (
                    <button type="button" onClick={() => startReassign(row)} className="text-xs text-amber-400 font-semibold">
                      Reasignar tránsito a preventivo →
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
