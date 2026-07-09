// Selector de ubicación (bodega/técnico) con opción de crear una bodega
// nueva sin salir del formulario — usado dondequiera que se elija una
// bodega (Registro de movimientos, Nuevo conteo). Antes solo listaba lo
// existente y dejaba sin salida al usuario si la bodega no estaba creada.

import { useEffect, useState } from 'react'
import { crearUbicacion, listUbicaciones } from '@/lib/inventario/inventarioRepo'
import type { Ubicacion, UbicacionTipo } from '@/lib/inventario/types'

const NUEVA = '__nueva__'

interface Props {
  value: string
  onChange: (id: string) => void
  tipo?: UbicacionTipo
  placeholder?: string
  className?: string
}

export function UbicacionSelect({ value, onChange, tipo, placeholder = 'Elegir ubicación…', className }: Props) {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [creating, setCreating] = useState(false)
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try { setUbicaciones(await listUbicaciones(tipo ? { tipo } : undefined)) } catch { /* silencioso: el selector queda vacío */ }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tipo])

  async function crear() {
    if (!nombre.trim()) return
    setBusy(true)
    setError(null)
    try {
      const nueva = await crearUbicacion(nombre.trim())
      await reload()
      onChange(nueva.id)
      setCreating(false)
      setNombre('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className={className}>
        <div className="flex gap-1.5">
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la bodega"
            onKeyDown={(e) => { if (e.key === 'Enter') crear() }}
            className="flex-1 min-w-0 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
          <button type="button" onClick={crear} disabled={busy || !nombre.trim()}
            className="text-xs font-semibold px-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 shrink-0">
            {busy ? '…' : '✓'}
          </button>
          <button type="button" onClick={() => { setCreating(false); setNombre(''); setError(null) }}
            className="text-xs text-slate-400 px-1 shrink-0">✕</button>
        </div>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    )
  }

  return (
    <select value={value} className={className}
      onChange={(e) => (e.target.value === NUEVA ? setCreating(true) : onChange(e.target.value))}>
      <option value="">{placeholder}</option>
      {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.tipo === 'tecnico' ? ' (técnico)' : ''}</option>)}
      <option value={NUEVA}>+ Nueva bodega…</option>
    </select>
  )
}
