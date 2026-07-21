import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePreventivoStore, hasPendingSync } from '../store'
import { preventivoRepo } from '../data/preventivoRepo'
import { useAuth } from '@/lib/auth'
import { ImportZip } from './ImportZip'
import type { Preventivo } from '../types'

type EstadoFilter = 'activo' | 'cerrado' | 'todos'

function matchesSearch(r: Preventivo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const { comuna, cuadrante, nombreCuadrante } = r.cuadrante
  return (comuna ?? '').toLowerCase().includes(q)
    || (cuadrante ?? '').toLowerCase().includes(q)
    || (nombreCuadrante ?? '').toLowerCase().includes(q)
}

export function Home() {
  const navigate = useNavigate()
  const { records, createNew, remove, syncList } = usePreventivoStore()
  const isAdmin = useAuth((s) => s.profile?.rol === 'admin')

  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('activo')
  const [search, setSearch] = useState('')
  const [extra, setExtra] = useState<Preventivo[]>([])

  useEffect(() => { syncList().catch(console.error) }, [syncList])

  async function reloadExtra() {
    if (estadoFilter === 'activo') return
    try { setExtra(await preventivoRepo.list({ estado: estadoFilter })) } catch (err) { console.error(err) }
  }
  useEffect(() => { reloadExtra().catch(console.error) }, [estadoFilter])

  // No basta con confiar en que `records` solo tiene activos: el selector de
  // estado del Editor (EstadoProyectoBadge) cierra un levantamiento
  // actualizando su `estado` en la caché SIN sacarlo de `records` (a
  // propósito, para no hacer desaparecer la página mientras se está
  // editando) — hay que filtrar acá.
  const base = estadoFilter === 'activo' ? Object.values(records).filter((r) => r.estado === 'activo') : extra
  const list = base.filter((r) => matchesSearch(r, search)).sort((a, b) => b.updatedAt - a.updatedAt)
  const pending = Object.values(records).filter(hasPendingSync)

  function handleNew() {
    const id = createNew()
    navigate(`/preventivos/${id}`)
  }

  async function handleDelete(r: Preventivo) {
    const msg = isAdmin
      ? '¿Eliminar este levantamiento? Esta acción no se puede deshacer.'
      : '¿Cerrar este levantamiento? Se ocultará de la lista; solo un administrador puede eliminarlo definitivamente.'
    if (!confirm(msg)) return
    const result = await remove(r.id)
    if (!result.ok) { alert(result.error); return }
    reloadExtra().catch(console.error)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">📡 Levantamientos</h1>
          <p className="text-xs text-slate-400">{list.length} levantamiento(s)</p>
        </div>
        <button type="button" onClick={handleNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2 rounded-xl">
          ➕ Nuevo
        </button>
      </div>

      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por comuna, cuadrante o nombre…"
          className="flex-1 min-w-0 bg-slate-800 text-white text-sm rounded-xl px-3 py-2 border border-slate-700 placeholder-slate-500 focus:border-brand-500 focus:outline-none" />
        <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as EstadoFilter)}
          className="bg-slate-800 text-white text-sm rounded-xl px-2 py-2 border border-slate-700 focus:border-brand-500 focus:outline-none shrink-0">
          <option value="activo">Activos</option>
          <option value="cerrado">Cerrados</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
        <p className="text-sm font-medium text-white">Importar ZIP existente</p>
        <ImportZip onImported={(id) => navigate(`/preventivos/${id}`)} />
        <p className="text-[10px] text-amber-400/80">
          ⚠ En WhatsApp: enviar como <strong>Documento</strong> (clip 📎), no como imagen
        </p>
      </div>

      {pending.length > 0 && <MigrationBanner pending={pending} />}

      {list.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🔌</div>
          <p className="text-sm">
            {search || estadoFilter !== 'activo' ? 'Sin resultados.' : 'Crea tu primer levantamiento o importa un ZIP.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <CuadranteCard key={r.id} record={r}
              onSelect={() => navigate(`/preventivos/${r.id}`)}
              onDelete={() => { handleDelete(r).catch(console.error) }} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Aviso + acción para subir a Supabase los levantamientos que quedaron solo
 * en este dispositivo: borradores nunca guardados, o levantamientos ya
 * sincronizados a los que les quedó una foto capturada localmente sin subir.
 * Reutiliza `persistToServer`, el mismo camino del autoguardado del Editor.
 */
function MigrationBanner({ pending }: { pending: Preventivo[] }) {
  const persistToServer = usePreventivoStore((s) => s.persistToServer)
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
          <p className="text-sm font-semibold text-amber-300">⚠️ {pending.length} levantamiento(s) sin sincronizar</p>
          <p className="text-xs text-amber-400/80 mt-0.5">Guardados solo en este dispositivo. Sincronízalos para no perderlos.</p>
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
                ❌ {r.cuadrante.cuadrante || 'Sin ID'} — {results[r.id]?.message}
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

function CuadranteCard({ record, onSelect, onDelete }: {
  record: Preventivo; onSelect: () => void; onDelete: () => void
}) {
  const fotos = record.puntos.reduce(
    (n, p) => n + (p.fotoLevantamiento ? 1 : 0) + (p.fotoAntes ? 1 : 0) + (p.fotoDespues ? 1 : 0), 0)
  const conFoto = record.puntos.filter((p) => p.fotoLevantamiento || p.fotoAntes || p.fotoDespues).length
  const total = record.puntos.length

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 hover:border-brand-500 transition-colors">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect} className="flex-1 text-left min-w-0">
          {record.estado === 'cerrado' && (
            <span className="inline-block text-[10px] font-medium text-slate-400 bg-slate-700 rounded px-1.5 py-0.5 mb-1">
              🔒 Cerrado{record.fechaCierre ? ` ${record.fechaCierre}` : ''}
            </span>
          )}
          <div className="text-sm text-white">
            {record.cuadrante.comuna
              ? <><span className="font-bold">{record.cuadrante.comuna}</span><span className="text-slate-400"> — {record.cuadrante.cuadrante || 'Sin ID'}</span></>
              : <span className="font-bold">{record.cuadrante.cuadrante || 'Sin ID'}</span>}
          </div>
          {record.cuadrante.nombreCuadrante && (
            <div className="text-xs text-slate-400 mt-0.5 truncate">{record.cuadrante.nombreCuadrante}</div>
          )}
          <div className="flex gap-3 mt-1.5 flex-wrap">
            <span className="text-[11px] text-slate-500">{total} punto(s)</span>
            <span className="text-[11px] text-slate-500">📷 {fotos}</span>
            {total > 0 && (
              <span className={`text-[11px] font-medium ${conFoto === total ? 'text-green-400' : 'text-amber-400'}`}>
                {conFoto}/{total} con foto
              </span>
            )}
            {record.cuadrante.fecha && <span className="text-[11px] text-slate-500">📅 {record.cuadrante.fecha}</span>}
          </div>
          {total > 0 && (
            <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(conFoto / total) * 100}%` }} />
            </div>
          )}
        </button>
        <button type="button" onClick={onDelete}
          className="text-slate-600 hover:text-red-400 text-lg p-1 leading-none shrink-0">×</button>
      </div>
    </div>
  )
}
