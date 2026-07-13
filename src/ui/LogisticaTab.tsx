// Pestaña "Logística" compartida por ATT y Preventivos: equipo asignado al
// proyecto, resumen de material (solicitado/entregado/instalado/devuelto/
// rebajado/tránsito) con acción de reasignar tránsito a preventivo, y el
// formulario de alta de movimientos fijado a este proyecto.

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { ROL_LABELS } from '@/lib/auth'
import { RegistrarMovimientoForm } from './RegistrarMovimientoForm'
import { ResumenProyectoTable } from './ResumenProyectoTable'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  projectOtt: string
  area: 'ATT' | 'OyM'
  puntos?: Punto[]
}

export function LogisticaTab({ projectId, projectOtt, area, puntos }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="space-y-4">
      <EquipoSection projectId={projectId} />
      <ResumenProyectoTable projectId={projectId} area={area} puntos={puntos} refreshKey={refreshKey} />
      <RegistrarMovimientoForm
        fixedProject={{ id: projectId, ott: projectOtt, area }}
        puntos={puntos}
        onRegistered={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  )
}

function EquipoSection({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<MemberProfile[] | null>(null)
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  async function reload() {
    try { setMembers(await adminRepo.listMembers(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  useEffect(() => {
    reload()
    adminRepo.listProfiles()
      .then((all) => setCandidates(all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log'))))
      .catch(() => {})
  }, [projectId])

  async function toggle(userId: string, isMember: boolean) {
    setBusyUserId(userId)
    setError(null)
    try {
      if (isMember) await adminRepo.removeMember(projectId, userId)
      else await adminRepo.addMember(projectId, userId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Técnicos asignados</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {members === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-slate-500">No hay técnicos ni logística registrados todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c) => {
            const isMember = members.some((m) => m.id === c.id)
            return (
              <label key={c.id} className="flex items-center justify-between gap-2 bg-slate-700/50 rounded-lg px-3 py-2 text-sm cursor-pointer">
                <span className="text-slate-200 truncate">
                  {c.nombre?.trim() || c.email} <span className="text-slate-500 text-xs">({ROL_LABELS[c.rol]})</span>
                </span>
                <input type="checkbox" checked={isMember} disabled={busyUserId === c.id}
                  onChange={() => toggle(c.id, isMember)} />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

