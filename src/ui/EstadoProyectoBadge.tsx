import { useState } from 'react'
import { useAuth } from '@/lib/auth'

type Estado = 'activo' | 'cerrado'

interface Props {
  estado: Estado
  onChange: (estado: Estado) => Promise<{ ok: boolean; error?: string }>
}

/**
 * Selector de estado (Abierto/Cerrado) sobre las pestañas del Editor —
 * candado de UI nada más: solo jp/admin pueden cambiarlo (misma RLS de
 * `projects` que usa el cierre desde Home), el resto ve un badge fijo.
 */
export function EstadoProyectoBadge({ estado, onChange }: Props) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeCambiar = rol === 'admin' || rol === 'jp'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: Estado) {
    if (next === estado || busy) return
    setBusy(true)
    setError(null)
    const result = await onChange(next)
    if (!result.ok) setError(result.error ?? 'No se pudo cambiar el estado.')
    setBusy(false)
  }

  if (!puedeCambiar) {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0 ${
        estado === 'cerrado' ? 'bg-slate-700 text-slate-400' : 'bg-emerald-900/50 text-emerald-300'
      }`}>
        {estado === 'cerrado' ? '🔒 Cerrado' : '🟢 Abierto'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <select value={estado} disabled={busy}
        onChange={(e) => handleChange(e.target.value as Estado)}
        className={`text-[11px] font-semibold rounded-lg px-2 py-1 border focus:outline-none disabled:opacity-50 ${
          estado === 'cerrado' ? 'bg-slate-700 text-slate-300 border-slate-600' : 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
        }`}>
        <option value="activo">🟢 Abierto</option>
        <option value="cerrado">🔒 Cerrado</option>
      </select>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}
