import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { agregarObservacion, eliminarObservacion, listObservaciones } from '@/lib/inventario/inventarioRepo'
import type { Observacion } from '@/lib/inventario/types'

/**
 * Notas libres de un proyecto: sin edición, solo agregar/borrar (la RLS
 * limita el borrado a la propia entrada, salvo admin/jp/log que pueden
 * borrar cualquiera — log tiene los mismos privilegios que jp, ver
 * supabase/migrations/0016_observaciones.sql y 0018_log_como_jp.sql).
 */
export function ObservacionesSection({ projectId }: { projectId: string }) {
  const session = useAuth((s) => s.session)
  const rol = useAuth((s) => s.profile?.rol)
  const puedeBorrarTodo = rol === 'admin' || rol === 'jp' || rol === 'log'

  const [items, setItems] = useState<Observacion[] | null>(null)
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function reload() {
    try { setItems(await listObservaciones(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  async function agregar() {
    const t = texto.trim()
    if (!t) return
    setBusy(true)
    setError(null)
    try {
      await agregarObservacion(projectId, t)
      setTexto('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function borrar(id: string) {
    if (!confirm('¿Borrar esta observación?')) return
    setDeletingId(id)
    try {
      await eliminarObservacion(id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Observaciones</h2>

      <div className="space-y-2">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
          placeholder="Ej. Instalé 2 ODF que no aparecen como entregados en este proyecto…"
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:border-brand-500 focus:outline-none placeholder-slate-500" />
        <button type="button" disabled={busy || !texto.trim()} onClick={agregar}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
          {busy ? 'Agregando…' : '➕ Agregar observación'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {items === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">Sin observaciones todavía.</p>
      ) : (
        <div className="space-y-2">
          {items.map((o) => {
            const puedeBorrar = puedeBorrarTodo || o.usuarioId === session?.user.id
            return (
              <div key={o.id} className="bg-slate-700/40 rounded-xl border border-slate-700 p-3">
                <p className="text-sm text-slate-100 whitespace-pre-wrap">{o.texto}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[10px] text-slate-500">
                    {o.usuarioNombre ?? 'Alguien'} · {new Date(o.createdAt).toLocaleString('es-CL')}
                  </p>
                  {puedeBorrar && (
                    <button type="button" disabled={deletingId === o.id} onClick={() => borrar(o.id)}
                      className="text-[10px] text-slate-500 hover:text-red-400 disabled:opacity-40">
                      {deletingId === o.id ? 'Borrando…' : 'Borrar'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
