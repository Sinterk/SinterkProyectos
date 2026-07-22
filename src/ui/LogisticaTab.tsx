// Pestaña "Logística" compartida por ATT y Preventivos: equipo asignado al
// proyecto, resumen/alta de material en una sola tabla (ver
// ResumenProyectoTable — "+ Nuevo material" reemplaza al formulario aparte
// que vivía acá), y observaciones libres. El rol técnico ve una versión
// reducida: solo Material y Observaciones (sin equipo asignado) — edita
// instalado/devuelto directo en la tabla de Material (ResumenProyectoTable
// ya restringe qué campos son editables por rol).

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { useAuth, ROL_LABELS } from '@/lib/auth'
import { ResumenProyectoTable } from './ResumenProyectoTable'
import { ObservacionesSection } from './ObservacionesSection'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  area: 'ATT' | 'OyM'
  puntos?: Punto[]
}

export function LogisticaTab({ projectId, area, puntos }: Props) {
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')
  // EquipoSection y ResumenProyectoTable leen `project_members` cada uno por
  // su cuenta (listas separadas, sin estado compartido) — sin este contador,
  // asignar un técnico acá no se reflejaba en el selector de "+ Nuevo
  // material" hasta salir y volver a entrar a la OTT.
  const [membersVersion, setMembersVersion] = useState(0)
  return (
    <div className="space-y-4">
      {!isTecnico && (
        <EquipoSection projectId={projectId} onMembersChanged={() => setMembersVersion((v) => v + 1)} />
      )}
      <ResumenProyectoTable projectId={projectId} area={area} puntos={puntos} membersVersion={membersVersion} />
      <ObservacionesSection projectId={projectId} />
    </div>
  )
}

function EquipoSection({ projectId, onMembersChanged }: { projectId: string; onMembersChanged: () => void }) {
  const [members, setMembers] = useState<MemberProfile[] | null>(null)
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')

  async function reload() {
    try { setMembers(await adminRepo.listMembers(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  useEffect(() => {
    reload()
    adminRepo.listProfiles()
      .then((all) => setCandidates(all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log'))))
      .catch(() => {})
  }, [projectId])

  async function add(userId: string) {
    if (!userId) return
    setBusyUserId(userId)
    setError(null)
    try {
      await adminRepo.addMember(projectId, userId)
      await reload()
      onMembersChanged()
      setSelectedId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  async function remove(userId: string) {
    setBusyUserId(userId)
    setError(null)
    try {
      await adminRepo.removeMember(projectId, userId)
      await reload()
      onMembersChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  // Con la planilla real de personal cargada (30+ técnicos), un checklist con
  // todos a la vista dejó de ser práctico — se reemplaza por la lista de ya
  // asignados (quitar con ×) + un desplegable de los que faltan + "Agregar".
  const disponibles = candidates.filter((c) => !members?.some((m) => m.id === c.id))

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Técnicos asignados</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {members === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          {members.length === 0 ? (
            <p className="text-xs text-slate-500">Nadie asignado todavía.</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => {
                const c = candidates.find((cc) => cc.id === m.id)
                return (
                  <div key={m.id} className="flex items-center justify-between gap-2 bg-slate-700/50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-200 truncate">
                      {m.nombre?.trim() || m.email}
                      {c && <span className="text-slate-500 text-xs"> ({ROL_LABELS[c.rol]})</span>}
                    </span>
                    <button type="button" onClick={() => remove(m.id)} disabled={busyUserId === m.id}
                      className="text-slate-500 hover:text-red-400 text-base leading-none shrink-0 disabled:opacity-40">
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {disponibles.length === 0 ? (
            members.length === 0 && <p className="text-xs text-slate-500">No hay técnicos ni logística registrados todavía.</p>
          ) : (
            <div className="flex gap-2">
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
                className="flex-1 min-w-0 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
                <option value="">Elegir técnico o logística…</option>
                {disponibles.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre?.trim() || c.email} ({ROL_LABELS[c.rol]})</option>
                ))}
              </select>
              <button type="button" onClick={() => add(selectedId)} disabled={!selectedId || busyUserId === selectedId}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
                + Agregar
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

