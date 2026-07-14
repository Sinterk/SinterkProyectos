import { useState } from 'react'
import { useAuth, guestEnabled, guestTecnicoEnabled } from '@/lib/auth'

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn)
  const signInAsGuest = useAuth((s) => s.signInAsGuest)
  const signInAsGuestTecnico = useAuth((s) => s.signInAsGuestTecnico)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [guestBusy, setGuestBusy] = useState(false)
  const [guestTecnicoBusy, setGuestTecnicoBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    const { error } = await signIn(email, password)
    if (error) {
      setError(
        error.toLowerCase().includes('invalid')
          ? 'Correo o contraseña incorrectos.'
          : error,
      )
      setBusy(false)
    }
    // si es correcto, onAuthStateChange actualiza la sesión y App re-renderiza
  }

  async function handleGuest() {
    if (guestBusy) return
    setError(null)
    setGuestBusy(true)
    const { error } = await signInAsGuest()
    if (error) {
      setError(
        error.toLowerCase().includes('invalid')
          ? 'La cuenta de invitado no está disponible. Avisa al administrador.'
          : error,
      )
      setGuestBusy(false)
    }
  }

  async function handleGuestTecnico() {
    if (guestTecnicoBusy) return
    setError(null)
    setGuestTecnicoBusy(true)
    const { error } = await signInAsGuestTecnico()
    if (error) {
      setError(
        error.toLowerCase().includes('invalid')
          ? 'La cuenta de invitado técnico no está disponible. Avisa al administrador.'
          : error,
      )
      setGuestTecnicoBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">📡</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">TelecomCatalog</h1>
          <p className="text-slate-400 text-sm mt-2">Gestión de proyectos de telecomunicaciones</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-800 rounded-2xl border border-slate-700 p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-500 font-medium">Usuario</label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.cl"
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500 font-medium">Contraseña</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || guestBusy || guestTecnicoBusy || !email || !password}
            className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        {(guestEnabled || guestTecnicoEnabled) && (
          <div className="mt-4">
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="h-px flex-1 bg-slate-700" />
              o
              <span className="h-px flex-1 bg-slate-700" />
            </div>
            {guestEnabled && (
              <button
                type="button"
                onClick={handleGuest}
                disabled={busy || guestBusy || guestTecnicoBusy}
                className="mt-4 w-full py-2.5 rounded-xl border border-slate-600 hover:border-slate-500 hover:bg-slate-800 text-slate-200 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {guestBusy ? 'Entrando…' : 'Continuar como invitado'}
              </button>
            )}
            {guestTecnicoEnabled && (
              <button
                type="button"
                onClick={handleGuestTecnico}
                disabled={busy || guestBusy || guestTecnicoBusy}
                className="mt-2 w-full py-2.5 rounded-xl border border-slate-600 hover:border-slate-500 hover:bg-slate-800 text-slate-200 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {guestTecnicoBusy ? 'Entrando…' : 'Continuar como invitado (técnico)'}
              </button>
            )}
            <p className="text-center text-[11px] text-slate-600 mt-2">
              Cuentas compartidas temporales para trabajar sin usuario propio.
            </p>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-600 mt-6">
          ¿Sin cuenta? Solicítala a un administrador.
        </p>
      </div>
    </div>
  )
}
