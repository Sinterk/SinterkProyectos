import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAttStore, hasPendingSync } from '../store'
import { attRepo, isUuid } from '../data/attRepo'
import { fechaInicioDe } from '../utils/fechaInicio'
import { getTotalesMaterialPorProyecto } from '@/lib/inventario/inventarioRepo'
import type { TotalesMaterialProyecto } from '@/lib/inventario/inventarioRepo'
import { useAuth } from '@/lib/auth'
import { TIPO_PROYECTO_LABELS } from '../types'
import type { AttRecord } from '../types'
import { DescargarCerradosPanel } from './DescargarCerradosPanel'
import { ZipArchiveViewer } from '@/ui/ZipArchiveViewer'

type EstadoFilter = 'activo' | 'cerrado' | 'todos'

function matchesSearch(r: AttRecord, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return r.ott.toLowerCase().includes(q) || r.nombreProyecto.toLowerCase().includes(q)
}

export function Home() {
  const navigate = useNavigate()
  const { records, createNew, remove, syncList } = useAttStore()
  const isAdmin = useAuth((s) => s.profile?.rol === 'admin')

  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('activo')
  const [search, setSearch] = useState('')
  // Cerrados/todos no viven en el store (que solo cachea activos editables):
  // se piden aparte, de solo consulta, y se refrescan al cambiar el filtro.
  const [extra, setExtra] = useState<AttRecord[]>([])
  const [showViewer, setShowViewer] = useState(false)

  useEffect(() => { syncList().catch(console.error) }, [syncList])

  async function reloadExtra() {
    if (estadoFilter === 'activo') return
    try { setExtra(await attRepo.list({ estado: estadoFilter })) } catch (err) { console.error(err) }
  }
  useEffect(() => { reloadExtra().catch(console.error) }, [estadoFilter])

  // No basta con confiar en que `records` solo tiene activos: el selector de
  // estado del Editor (EstadoProyectoBadge) cierra un informe actualizando su
  // `estado` en la caché SIN sacarlo de `records` (a propósito, para no hacer
  // desaparecer la página mientras se está editando) — hay que filtrar acá.
  const base = estadoFilter === 'activo' ? Object.values(records).filter((r) => r.estado === 'activo') : extra
  const list = base.filter((r) => matchesSearch(r, search)).sort((a, b) => b.updatedAt - a.updatedAt)

  // Entregado/instalado por OTT para las tarjetas. Se pide en una sola
  // consulta para toda la lista visible (no una por tarjeta), y se re-pide
  // solo cuando cambia el conjunto de ids — no en cada render, que sería un
  // ciclo infinito porque `list` se recalcula siempre.
  const [totales, setTotales] = useState<Record<string, TotalesMaterialProyecto>>({})
  const idsVisibles = list.filter((r) => isUuid(r.id)).map((r) => r.id).sort().join(',')
  useEffect(() => {
    const ids = idsVisibles ? idsVisibles.split(',') : []
    let cancelado = false
    getTotalesMaterialPorProyecto(ids)
      .then((t) => { if (!cancelado) setTotales(t) })
      .catch(() => { if (!cancelado) setTotales({}) })
    return () => { cancelado = true }
  }, [idsVisibles])
  const pending = Object.values(records).filter(hasPendingSync)

  function handleNew() {
    const id = createNew()
    navigate(`/att/${id}`)
  }

  async function handleDelete(r: AttRecord) {
    const msg = isAdmin
      ? '¿Eliminar este informe? Esta acción no se puede deshacer.'
      : '¿Cerrar este informe? Se ocultará de la lista; solo un administrador puede eliminarlo definitivamente.'
    if (!confirm(msg)) return
    const result = await remove(r.id)
    if (!result.ok) { alert(result.error); return }
    reloadExtra().catch(console.error)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">🔧 Informes ATT</h1>
          <p className="text-xs text-slate-400">{list.length} informe(s)</p>
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
          placeholder="Buscar por OTT o nombre…"
          className="flex-1 min-w-0 bg-slate-800 text-white text-sm rounded-xl px-3 py-2 border border-slate-700 placeholder-slate-500 focus:border-brand-500 focus:outline-none" />
        <select value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value as EstadoFilter)}
          className="bg-slate-800 text-white text-sm rounded-xl px-2 py-2 border border-slate-700 focus:border-brand-500 focus:outline-none shrink-0">
          <option value="activo">Activos</option>
          <option value="cerrado">Cerrados</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {pending.length > 0 && <MigrationBanner pending={pending} />}

      {estadoFilter === 'cerrado' && (
        <DescargarCerradosPanel records={extra} onChanged={() => { reloadExtra().catch(console.error) }} />
      )}

      {list.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🔌</div>
          <p className="text-sm">
            {search || estadoFilter !== 'activo' ? 'Sin resultados.' : 'Crea tu primer informe ATT.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <AttCard key={r.id} record={r} totales={totales[r.id]}
              onSelect={() => navigate(`/att/${r.id}`)}
              onDelete={() => { handleDelete(r).catch(console.error) }} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Aviso + acción para subir a Supabase los informes que quedaron solo en
 * este dispositivo: borradores nunca guardados (id nanoid, de antes del
 * cutover a backend) o informes ya sincronizados a los que les quedó una
 * foto capturada localmente sin subir (un guardado anterior que falló a
 * medio camino). Reutiliza `persistToServer`, el mismo camino del
 * autoguardado del Editor.
 */
function MigrationBanner({ pending }: { pending: AttRecord[] }) {
  const persistToServer = useAttStore((s) => s.persistToServer)
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
          <p className="text-sm font-semibold text-amber-300">⚠️ {pending.length} informe(s) sin sincronizar</p>
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
                ❌ {r.ott ? `OTT ${r.ott}` : 'Sin OTT'} — {results[r.id]?.message}
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

function AttCard({ record, totales, onSelect, onDelete }: {
  record: AttRecord; totales?: TotalesMaterialProyecto; onSelect: () => void; onDelete: () => void
}) {
  const fotoCount = record.fotos.length
  const tipoLabel = record.tipoProyecto ? TIPO_PROYECTO_LABELS[record.tipoProyecto] : null

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 hover:border-brand-500 transition-colors">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect} className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {tipoLabel && (
              <span className="text-[10px] font-medium text-brand-400 uppercase tracking-wide">{tipoLabel}</span>
            )}
            {record.estado === 'cerrado' && (
              <span className="text-[10px] font-medium text-slate-400 bg-slate-700 rounded px-1.5 py-0.5">
                🔒 Cerrado{record.fechaCierre ? ` ${record.fechaCierre}` : ''}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-white">
            {record.ott
              ? <>OTT <span className="font-mono">{record.ott}</span></>
              : <span className="text-slate-500 font-normal">Sin número OTT</span>}
          </div>
          {record.nombreProyecto && (
            <div className="text-xs text-slate-300 mt-0.5 truncate">{record.nombreProyecto}</div>
          )}
          {record.comuna && (
            <div className="text-xs text-slate-400 mt-0.5">📍 {record.comuna}{record.region ? `, ${record.region}` : ''}</div>
          )}
          {/* Datos de cabecera pedidos para la lista: fecha de comienzo siempre;
              el material solo desde tablet/escritorio — en móvil la tarjeta
              queda ilegible con todo junto. */}
          <div className="flex items-center gap-3 mt-1.5 text-[11px]">
            <span className="text-slate-400">📅 {fechaInicioDe(record)}</span>
            {/* Cable y "el resto" van separados a propósito: el cable se mide en
                metros y lo demás en unidades, así que un total único no diría
                nada. El criterio de qué es cable sale del Tipo del Catálogo
                (ver `esTipoCable`), el mismo que usa el Estado de Pago. */}
            <span className="hidden sm:inline text-slate-500" title="Cable entregado / instalado">
              Cable <span className="text-slate-300 font-medium">{totales?.cableEntregado ?? 0}</span>
              <span className="text-slate-600"> / </span>
              <span className="text-slate-300 font-medium">{totales?.cableInstalado ?? 0}</span>
            </span>
            <span className="hidden sm:inline text-slate-500" title="Material entregado / instalado">
              Material <span className="text-slate-300 font-medium">{totales?.materialEntregado ?? 0}</span>
              <span className="text-slate-600"> / </span>
              <span className="text-slate-300 font-medium">{totales?.materialInstalado ?? 0}</span>
            </span>
          </div>
          <div className="flex gap-3 mt-1.5 flex-wrap">
            {record.tramos.length > 0 && (
              <span className="text-[11px] text-slate-500">{record.tramos.length} tramo(s)</span>
            )}
            {fotoCount > 0 && (
              <span className="text-[11px] text-slate-500">📷 {fotoCount}</span>
            )}
            {record.hitos.length > 0 && (
              <span className="text-[11px] text-slate-500">{record.hitos.length} hito(s)</span>
            )}
          </div>
        </button>
        <button type="button" onClick={onDelete}
          className="text-slate-600 hover:text-red-400 text-lg p-1 leading-none shrink-0">×</button>
      </div>
    </div>
  )
}
