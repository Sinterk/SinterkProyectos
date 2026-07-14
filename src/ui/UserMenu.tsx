import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, guestPassword, guestTecnicoPassword, ROL_LABELS } from '@/lib/auth'

export function UserMenu() {
  const { session, profile, isGuest, guestKind, changePassword, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // cerrar al clic fuera
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!session) return null

  const email = profile?.email ?? session.user.email ?? '—'
  const rolLabel = profile ? ROL_LABELS[profile.rol] : '—'
  const guestLabel = guestKind === 'tecnico' ? 'Invitado técnico' : 'Invitado'
  const nombre = profile?.nombre?.trim() || (isGuest ? guestLabel : email)

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
          isGuest
            ? 'text-amber-300 bg-amber-500/15 border-amber-500/30 hover:bg-amber-500/25'
            : 'text-slate-200 bg-slate-800 border-slate-700 hover:bg-slate-700'
        }`}
      >
        <span>{isGuest ? `👤 ${guestLabel}` : `👤 ${nombre}`}</span>
        <span className="text-[9px] opacity-70">▼</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-40 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Correo</p>
            <p className="text-sm text-white break-all">{email}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-2">Tipo de usuario</p>
            <p className="text-sm text-white">{rolLabel}{isGuest && ' · cuenta compartida'}</p>
          </div>

          {profile?.rol === 'admin' && (
            <Link to="/admin" onClick={() => setOpen(false)}
              className="block px-4 py-3 text-sm text-brand-400 hover:bg-slate-700/60 border-b border-slate-700 transition-colors">
              ⚙️ Administración
            </Link>
          )}

          {isGuest ? (
            <GuestPasswordRow password={guestKind === 'tecnico' ? guestTecnicoPassword : guestPassword} />
          ) : (
            <ChangePasswordRow changePassword={changePassword} />
          )}

          <button
            onClick={signOut}
            className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-slate-700/60 border-t border-slate-700 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}

/** Invitado: la contraseña está en el bundle; se puede mostrar. No se cambia aquí. */
function GuestPasswordRow({ password }: { password: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="px-4 py-3 border-b border-slate-700 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">Contraseña</span>
        <button
          onClick={() => setShow((v) => !v)}
          className="text-xs text-brand-400 hover:text-brand-300"
        >
          {show ? 'Ocultar' : 'Mostrar contraseña'}
        </button>
      </div>
      {show && (
        <p className="text-sm font-mono text-white bg-slate-900 rounded-lg px-3 py-2 break-all">
          {password}
        </p>
      )}
      <p className="text-[11px] text-slate-500">
        Cuenta compartida: la contraseña se gestiona en el <code>.env</code>, no se cambia desde aquí.
      </p>
    </div>
  )
}

/** Usuario real: no se puede mostrar la clave (está hasheada); solo cambiarla. */
function ChangePasswordRow({
  changePassword,
}: {
  changePassword: (current: string, next: string) => Promise<{ error?: string }>
}) {
  const [openForm, setOpenForm] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  async function submit() {
    setMsg(null)
    if (next.length < 6) return setMsg({ text: 'La nueva contraseña debe tener al menos 6 caracteres.' })
    if (next !== confirm) return setMsg({ text: 'La confirmación no coincide.' })
    setBusy(true)
    const { error } = await changePassword(current, next)
    setBusy(false)
    if (error) return setMsg({ text: error })
    setMsg({ ok: true, text: 'Contraseña actualizada.' })
    setCurrent(''); setNext(''); setConfirm('')
    setOpenForm(false)
  }

  return (
    <div className="px-4 py-3 border-b border-slate-700">
      {!openForm ? (
        <button
          onClick={() => { setOpenForm(true); setMsg(null) }}
          className="text-sm text-brand-400 hover:text-brand-300"
        >
          Cambiar contraseña
        </button>
      ) : (
        <div className="space-y-2">
          <input type="password" autoComplete="current-password" placeholder="Contraseña actual"
            value={current} onChange={(e) => setCurrent(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none" />
          <input type="password" autoComplete="new-password" placeholder="Nueva contraseña"
            value={next} onChange={(e) => setNext(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none" />
          <input type="password" autoComplete="new-password" placeholder="Repetir nueva contraseña"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none" />
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={busy || !current || !next || !confirm}
              className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setOpenForm(false); setMsg(null) }}
              className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p className={`text-xs mt-2 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
      )}
    </div>
  )
}
