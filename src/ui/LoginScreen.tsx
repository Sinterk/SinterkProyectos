import { useState } from 'react'
import { useAuth, guestEnabled } from '@/lib/auth'

export function LoginScreen() {
  const signIn = useAuth((s) => s.signIn)
  const signInAsGuest = useAuth((s) => s.signInAsGuest)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [guestBusy, setGuestBusy] = useState(false)

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

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">📡</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">SinterkProyectos</h1>
          <p className="text-slate-400 text-sm mt-2">Gestión de proyectos de telecomunicaciones</p>
        </div>

        {/*
          Los `name`/`id` de los campos no son decorativos: los gestores de
          contraseñas (Firefox, Chrome, Bitwarden…) guardan junto a la clave en
          qué campo iba, identificándolo por `name` y usando `id` de respaldo.
          Sin ninguno de los dos el login queda guardado con campos anónimos y
          el autocompletado al cargar la página falla. `autoComplete` le dice
          cuál es cuál; `type="submit"` dentro de un <form> real es lo que
          dispara el "¿guardar contraseña?". No cambiar estos atributos sin
          entender que rompe las claves ya guardadas de todos los usuarios.
        */}
        <form onSubmit={handleSubmit} className="bg-slate-800 rounded-2xl border border-slate-700 p-6 space-y-4">
          <div className="space-y-1">
            <label htmlFor="login-username" className="text-xs text-slate-500 font-medium">Usuario</label>
            <input
              id="login-username"
              name="username"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.cl"
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="login-password" className="text-xs text-slate-500 font-medium">Contraseña</label>
            <input
              id="login-password"
              name="password"
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
            disabled={busy || guestBusy || !email || !password}
            className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        {guestEnabled && (
          <div className="mt-4">
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="h-px flex-1 bg-slate-700" />
              o
              <span className="h-px flex-1 bg-slate-700" />
            </div>
            <button
              type="button"
              onClick={handleGuest}
              disabled={busy || guestBusy}
              className="mt-4 w-full py-2.5 rounded-xl border border-slate-600 hover:border-slate-500 hover:bg-slate-800 text-slate-200 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guestBusy ? 'Entrando…' : 'Continuar como invitado'}
            </button>
            <p className="text-center text-[11px] text-slate-600 mt-2">
              Cuenta compartida temporal para trabajar sin usuario propio.
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
