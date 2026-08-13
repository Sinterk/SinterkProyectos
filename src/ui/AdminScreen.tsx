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
      <NuevoUsuarioForm onCreated={reload} />
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

/**
 * Alta de trabajador. Llama a la Edge Function `crear-usuario` — ver el
 * comentario de `adminRepo.crearUsuario` para el porqué de que no sea un
 * insert directo.
 *
 * La contraseña la escribe el admin y se la entrega a la persona; es
 * temporal por convención, no por sistema (todavía no hay "forzar cambio en
 * el primer ingreso" — la persona la cambia sola desde su menú de usuario).
 */
function NuevoUsuarioForm({ onCreated }: { onCreated: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<Profile['rol']>('tecnico')
  const [area, setArea] = useState<Profile['area']>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const inputCls = 'w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const labelCls = 'block text-[10px] text-slate-400 mb-0.5'

  function limpiar() {
    setEmail(''); setPassword(''); setNombre(''); setRol('tecnico'); setArea(null)
  }

  async function crear() {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await adminRepo.crearUsuario({ email, password, nombre, rol, area })
      setOk(`${nombre} creado. Entrégale el correo y la contraseña para que entre.`)
      limpiar()
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => { setAbierto(true); setOk(null) }}
        className="w-full text-xs font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white">
        ➕ Agregar trabajador
      </button>
    )
  }

  return (
    <div className="bg-slate-900/60 rounded-xl border border-slate-700 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2">
          <span className={labelCls}>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre y apellido" className={inputCls} />
        </label>
        <label className="col-span-2">
          <span className={labelCls}>Correo</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="usuario@sinterk.cl" className={inputCls} />
        </label>
        <label className="col-span-2">
          <span className={labelCls}>Contraseña temporal</span>
          {/* type="text" a propósito: el admin se la tiene que dictar a la
              persona, y ocultarla acá solo obliga a escribirla dos veces.
              autoComplete off para que el gestor no la guarde como propia. */}
          <input value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="off" placeholder="Mínimo 6 caracteres" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Rol</span>
          <select value={rol} onChange={(e) => setRol(e.target.value as Profile['rol'])} className={inputCls}>
            <option value="tecnico">Técnico</option>
            <option value="log">Logística</option>
            <option value="jp">Jefe de proyecto</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label>
          <span className={labelCls}>Área</span>
          <select value={area ?? ''} onChange={(e) => setArea((e.target.value || null) as Profile['area'])} className={inputCls}>
            <option value="">Sin área</option>
            <option value="ATT">ATT</option>
            <option value="OyM">OyM</option>
          </select>
        </label>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {ok && <p className="text-xs text-green-400">{ok}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={crear} disabled={busy || !nombre.trim() || !email.trim() || password.length < 6}
          className="flex-1 text-xs font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
          {busy ? 'Creando…' : 'Crear trabajador'}
        </button>
        <button type="button" onClick={() => { setAbierto(false); limpiar(); setError(null) }} disabled={busy}
          className="text-xs font-semibold py-2 px-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200">
          Cerrar
        </button>
      </div>
    </div>
  )
}

function UserRow({ profile, isSelf, onSaved }: { profile: Profile; isSelf: boolean; onSaved: () => void }) {
  const [nombre, setNombre] = useState(profile.nombre ?? '')
  const [rol, setRol] = useState<Rol>(profile.rol)
  const [area, setArea] = useState(profile.area ?? '')
  const [activo, setActivo] = useState(profile.activo)
  const [rut, setRut] = useState(profile.rut ?? '')
  const [cargo, setCargo] = useState(profile.cargo ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const dirty = nombre !== (profile.nombre ?? '') || rol !== profile.rol
    || area !== (profile.area ?? '') || activo !== profile.activo
    || rut !== (profile.rut ?? '') || cargo !== (profile.cargo ?? '')

  async function save() {
    setSaving(true)
    setMsg(null)
    try {
      await adminRepo.updateProfile(profile.id, {
        nombre: nombre.trim() || null, rol, area: area || null, activo,
        rut: rut.trim() || null, cargo: cargo.trim() || null,
      })
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
        <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="RUT"
          className="bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo"
          className="col-span-2 sm:col-span-2 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
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
  const [selectedUserId, setSelectedUserId] = useState('')

  useEffect(() => {
    adminRepo.listActiveProjects()
      .then((ps) => { setProjects(ps); if (ps.length > 0) setSelectedId(ps[0].id) })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // Cualquier trabajador, sin importar su área/rol (antes solo Terreno y
    // Logística) — mismo criterio que "Técnicos asignados" en la pestaña
    // Logística de la OTT, para que ambas pantallas ofrezcan la misma gente.
    adminRepo.listProfiles()
      .then(setCandidates)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setMembers(null)
    setSelectedUserId('')
    adminRepo.listMembers(selectedId).catch((err) => { setError(err instanceof Error ? err.message : String(err)); return [] }).then(setMembers)
  }, [selectedId])

  async function addMember(userId: string) {
    if (!userId) return
    setBusyUserId(userId)
    setError(null)
    try {
      await adminRepo.addMember(selectedId, userId)
      setMembers(await adminRepo.listMembers(selectedId))
      setSelectedUserId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  async function removeMember(userId: string) {
    setBusyUserId(userId)
    setError(null)
    try {
      await adminRepo.removeMember(selectedId, userId)
      setMembers(await adminRepo.listMembers(selectedId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  // Mismo patrón que EquipoSection (src/ui/LogisticaTab.tsx): con 30+
  // técnicos reales, un checklist con todos a la vista dejó de ser práctico.
  const disponibles = candidates.filter((c) => !members?.some((m) => m.id === c.id))

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
                        <button type="button" onClick={() => removeMember(m.id)} disabled={busyUserId === m.id}
                          className="text-slate-500 hover:text-red-400 text-base leading-none shrink-0 disabled:opacity-40">
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {disponibles.length === 0 ? (
                members.length === 0 && <p className="text-xs text-slate-500">No hay trabajadores registrados todavía.</p>
              ) : (
                <div className="flex gap-2">
                  <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
                    className="flex-1 min-w-0 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
                    <option value="">Elegir trabajador…</option>
                    {disponibles.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre?.trim() || c.email} ({ROL_LABELS[c.rol]})</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => addMember(selectedUserId)} disabled={!selectedUserId || busyUserId === selectedUserId}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
                    + Agregar
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
