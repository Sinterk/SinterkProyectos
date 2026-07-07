import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAttStore, hasPendingSync } from '../store'
import { useAuth } from '@/lib/auth'
import { TIPO_PROYECTO_LABELS } from '../types'
import type { AttRecord } from '../types'

export function Home() {
  const navigate = useNavigate()
  const { records, createNew, remove, syncList } = useAttStore()
  const isAdmin = useAuth((s) => s.profile?.rol === 'admin')
  const list = Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt)
  const pending = list.filter(hasPendingSync)

  useEffect(() => { syncList().catch(console.error) }, [syncList])

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
    if (!result.ok) alert(result.error)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">🔧 Informes ATT</h1>
          <p className="text-xs text-slate-400">{list.length} informe(s)</p>
        </div>
        <button type="button" onClick={handleNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2 rounded-xl">
          ➕ Nuevo
        </button>
      </div>

      {pending.length > 0 && <MigrationBanner pending={pending} />}

      {list.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🔌</div>
          <p className="text-sm">Crea tu primer informe ATT.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <AttCard key={r.id} record={r}
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

function AttCard({ record, onSelect, onDelete }: {
  record: AttRecord; onSelect: () => void; onDelete: () => void
}) {
  const fotoCount = record.fotos.length
  const tipoLabel = record.tipoProyecto ? TIPO_PROYECTO_LABELS[record.tipoProyecto] : null

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 hover:border-brand-500 transition-colors">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect} className="flex-1 text-left min-w-0">
          {tipoLabel && (
            <div className="text-[10px] font-medium text-brand-400 uppercase tracking-wide mb-1">{tipoLabel}</div>
          )}
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
