import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIncidenciaStore, hasPendingSync } from '../store'
import { incidenciaRepo } from '../data/incidenciaRepo'
import { useAuth } from '@/lib/auth'
import type { Incidencia } from '../types'
import { DescargarCerradosPanel } from './DescargarCerradosPanel'
import { ZipArchiveViewer } from '@/ui/ZipArchiveViewer'

type EstadoFilter = 'activo' | 'cerrado' | 'todos'

function matchesSearch(r: Incidencia, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return r.codigo.toLowerCase().includes(q) || r.direccion.toLowerCase().includes(q) || r.ingeniero.toLowerCase().includes(q)
}

export function Home() {
  const navigate = useNavigate()
  const { records, createNew, remove, syncList } = useIncidenciaStore()
  const isAdmin = useAuth((s) => s.profile?.rol === 'admin')

  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('activo')
  const [search, setSearch] = useState('')
  const [extra, setExtra] = useState<Incidencia[]>([])
  const [showViewer, setShowViewer] = useState(false)

  useEffect(() => { syncList().catch(console.error) }, [syncList])

  async function reloadExtra() {
    if (estadoFilter === 'activo') return
    try { setExtra(await incidenciaRepo.list({ estado: estadoFilter })) } catch (err) { console.error(err) }
  }
  useEffect(() => { reloadExtra().catch(console.error) }, [estadoFilter])

  // Mismo cuidado que ATT/Preventivos (PASO 20): el selector de estado del
  // Editor actualiza `estado` en la caché sin sacarlo de `records` — hay que
  // filtrar acá, no confiar en que `records` solo tenga activos.
  const base = estadoFilter === 'activo' ? Object.values(records).filter((r) => r.estado === 'activo') : extra
  const list = base.filter((r) => matchesSearch(r, search)).sort((a, b) => b.updatedAt - a.updatedAt)
  const pending = Object.values(records).filter(hasPendingSync)

  function handleNew() {
    const id = createNew()
    navigate(`/incidencias/${id}`)
  }

  async function handleDelete(r: Incidencia) {
    const msg = isAdmin
      ? '¿Eliminar esta incidencia? Esta acción no se puede deshacer.'
      : '¿Cerrar esta incidencia? Se ocultará de la lista; solo un administrador puede eliminarla definitivamente.'
    if (!confirm(msg)) return
    const result = await remove(r.id)
    if (!result.ok) { alert(result.error); return }
    reloadExtra().catch(console.error)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">🚨 Incidencias</h1>
          <p className="text-xs text-slate-400">{list.length} incidencia(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowViewer(true)}
            className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-3 py-2 rounded-xl">
            📂 Abrir descargado
          </button>
          <button type="button" onClick={handleNew}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2 rounded-xl">
            ➕ Nuevo
          </button>
        </div>
      </div>

      {showViewer && <ZipArchiveViewer onClose={() => setShowViewer(false)} />}

      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, dirección o ingeniero…"
          className="flex-1 min-w-0 bg-slate-800 text-white text-sm rounded-xl px-3 py-2 border border-slate-700 placeholder-slate-500 focus:border-brand-500 focus:outline-none" />
        <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as EstadoFilter)}
          className="bg-slate-800 text-white text-sm rounded-xl px-2 py-2 border border-slate-700 focus:border-brand-500 focus:outline-none shrink-0">
          <option value="activo">Activas</option>
          <option value="cerrado">Cerradas</option>
          <option value="todos">Todas</option>
        </select>
      </div>

      {pending.length > 0 && <MigrationBanner pending={pending} />}

      {estadoFilter === 'cerrado' && (
        <DescargarCerradosPanel records={extra} onChanged={() => { reloadExtra().catch(console.error) }} />
      )}

      {list.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🚨</div>
          <p className="text-sm">
            {search || estadoFilter !== 'activo' ? 'Sin resultados.' : 'Crea tu primera incidencia.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <IncidenciaCard key={r.id} record={r}
              onSelect={() => navigate(`/incidencias/${r.id}`)}
              onDelete={() => { handleDelete(r).catch(console.error) }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Mismo patrón que att/preventivos: borradores locales nunca subidos, o con fotos capturadas sin subir. */
function MigrationBanner({ pending }: { pending: Incidencia[] }) {
  const persistToServer = useIncidenciaStore((s) => s.persistToServer)
  const [migrating, setMigrating] = useState(false)
  const [results, setResults] = useState<Record<string, { ok: boolean; message?: string }>>({})

  async function migrateOne(id: string) {
    try {
      await persistToServer(id)
      setResults((prev) => ({ ...prev, [id]: { ok: true } }))
    } catch (err) {
      setResults((prev) => ({ ...prev, [id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }))
    }
  }

  async function migrateAll() {
    setMigrating(true)
    for (const r of pending) await migrateOne(r.id)
    setMigrating(false)
  }

  const failed = pending.filter((r) => results[r.id]?.ok === false)

  return (
    <div className="bg-amber-950/40 border border-amber-700/50 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-300">⚠️ {pending.length} incidencia(s) sin sincronizar</p>
          <p className="text-xs text-amber-400/80 mt-0.5">Guardadas solo en este dispositivo. Sincronízalas para no perderlas.</p>
        </div>
        <button type="button" onClick={() => migrateAll().catch(console.error)} disabled={migrating}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2 rounded-xl shrink-0 whitespace-nowrap">
          {migrating ? '⏳ Sincronizando…' : 'Sincronizar ahora'}
        </button>
      </div>

      {failed.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-amber-700/30">
          {failed.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-amber-200 truncate" title={results[r.id]?.message}>
                ❌ {r.codigo ? `Código ${r.codigo}` : 'Sin código'} — {results[r.id]?.message}
              </span>
              <button type="button" onClick={() => migrateOne(r.id).catch(console.error)}
                className="text-amber-400 hover:text-amber-300 underline shrink-0">Reintentar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IncidenciaCard({ record, onSelect, onDelete }: {
  record: Incidencia; onSelect: () => void; onDelete: () => void
}) {
  const fotoCount = record.fotos.length

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 hover:border-brand-500 transition-colors">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect} className="flex-1 text-left min-w-0">
          {record.estado === 'cerrado' && (
            <span className="inline-block text-[10px] font-medium text-slate-400 bg-slate-700 rounded px-1.5 py-0.5 mb-1">
              🔒 Cerrada{record.fechaCierre ? ` ${record.fechaCierre}` : ''}
            </span>
          )}
          <div className="text-sm font-semibold text-white">
            {record.codigo
              ? <>Código <span className="font-mono">{record.codigo}</span></>
              : <span className="text-slate-500 font-normal">Sin código</span>}
          </div>
          {record.direccion && (
            <div className="text-xs text-slate-300 mt-0.5 truncate">📍 {record.direccion}</div>
          )}
          {record.ingeniero && (
            <div className="text-xs text-slate-400 mt-0.5">{record.ingeniero}</div>
          )}
          {fotoCount > 0 && (
            <div className="flex gap-3 mt-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500">📷 {fotoCount}</span>
            </div>
          )}
        </button>
        <button type="button" onClick={onDelete}
          className="text-slate-600 hover:text-red-400 text-lg p-1 leading-none shrink-0">×</button>
      </div>
    </div>
  )
}
