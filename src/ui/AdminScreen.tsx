import { useEffect, useState } from 'react'
import { useAuth, ROL_LABELS } from '@/lib/auth'
import type { Rol, Profile } from '@/lib/auth'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary, MemberProfile } from '@/lib/adminRepo'

const ROLES: Rol[] = ['admin', 'jp', 'tecnico', 'log']
const AREAS = ['ATT', 'OyM'] as const

export function AdminScreen() {
  const isAdmin = useAuth((s) => s.profile?.rol === 'admin')

  if (!isAdmin) {
    return (
      <div className="text-center py-16 text-slate-500 space-y-2">
        <div className="text-4xl">🔒</div>
        <p className="text-sm">Solo un administrador puede ver esta pantalla.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">⚙️ Administración</h1>
        <p className="text-xs text-slate-400">Usuarios, roles y equipos por proyecto.</p>
      </div>
      <UsersSection />
      <TeamsSection />
    </div>
  )
}

function UsersSection() {
  const currentUserId = useAuth((s) => s.session?.user.id)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try { setProfiles(await adminRepo.listProfiles()) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  useEffect(() => { reload() }, [])

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Usuarios</h2>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Para dar de alta un usuario nuevo: Supabase → Authentication → Add user (marcar <em>Auto Confirm</em>).
        Aparecerá aquí con rol "Técnico" por defecto — edítalo abajo.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!profiles ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <UserRow key={p.id} profile={p} isSelf={p.id === currentUserId} onSaved={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

function UserRow({ profile, isSelf, onSaved }: { profile: Profile; isSelf: boolean; onSaved: () => void }) {
  const [nombre, setNombre] = useState(profile.nombre ?? '')
  const [rol, setRol] = useState<Rol>(profile.rol)
  const [area, setArea] = useState(profile.area ?? '')
  const [activo, setActivo] = useState(profile.activo)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const dirty = nombre !== (profile.nombre ?? '') || rol !== profile.rol
    || area !== (profile.area ?? '') || activo !== profile.activo

  async function save() {
    setSaving(true)
    setMsg(null)
    try {
      await adminRepo.updateProfile(profile.id, { nombre: nombre.trim() || null, rol, area: area || null, activo })
      setMsg({ ok: true, text: 'Guardado' })
      onSaved()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-slate-700/50 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-white truncate">{profile.email}{isSelf && <span className="text-slate-500"> (tú)</span>}</p>
        <label className={`flex items-center gap-1.5 text-xs shrink-0 ${isSelf ? 'text-slate-500' : 'text-slate-300'}`}>
          <input type="checkbox" checked={activo} disabled={isSelf}
            onChange={(e) => setActivo(e.target.checked)} />
          Activo
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre"
          className="col-span-2 sm:col-span-1 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        <select value={rol} disabled={isSelf} onChange={(e) => setRol(e.target.value as Rol)}
          className="bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none disabled:opacity-50">
          {ROLES.map((r) => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
        </select>
        <select value={area} onChange={(e) => setArea(e.target.value)}
          className="bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
          <option value="">Sin área</option>
          {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {isSelf && (
        <p className="text-[11px] text-slate-500">No puedes cambiar tu propio rol ni desactivarte — pide a otro admin que lo haga.</p>
      )}
      <div className="flex items-center justify-between gap-2">
        {msg && <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

/** Asigna/quita técnicos (project_members) de un proyecto ATT activo. */
function TeamsSection() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [members, setMembers] = useState<MemberProfile[] | null>(null)
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    adminRepo.listActiveProjects()
      .then((ps) => { setProjects(ps); if (ps.length > 0) setSelectedId(ps[0].id) })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    adminRepo.listProfiles()
      .then((all) => setCandidates(all.filter((p) => p.rol === 'tecnico' || p.rol === 'log')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setMembers(null)
    adminRepo.listMembers(selectedId).catch((err) => { setError(err instanceof Error ? err.message : String(err)); return [] }).then(setMembers)
  }, [selectedId])

  async function toggleMember(userId: string, isMember: boolean) {
    setBusyUserId(userId)
    setError(null)
    try {
      if (isMember) await adminRepo.removeMember(selectedId, userId)
      else await adminRepo.addMember(selectedId, userId)
      setMembers(await adminRepo.listMembers(selectedId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Equipo por proyecto</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {!projects ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : projects.length === 0 ? (
        <p className="text-xs text-slate-500">No hay proyectos activos.</p>
      ) : (
        <>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.area === 'ATT' ? 'ATT' : 'Preventivo'}] {p.ott || 'Sin código'}
                {p.nombreProyecto ? ` — ${p.nombreProyecto}` : p.comuna ? ` — ${p.comuna}` : ''}
              </option>
            ))}
          </select>

          {members === null ? (
            <p className="text-xs text-slate-500">Cargando equipo…</p>
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
                      onChange={() => toggleMember(c.id, isMember)} />
                  </label>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
