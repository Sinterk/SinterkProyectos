import { useEffect, useState } from 'react'
import { getTecnicoLedger } from '@/lib/inventario/inventarioRepo'
import { Stat } from './ResumenProyectoTable'
import { useAuth } from '@/lib/auth'
import type { TecnicoLedgerRow } from '@/lib/inventario/types'

/**
 * Resumen de "qué tengo en mi poder" para el rol técnico: lo que le han
 * entregado menos lo instalado menos lo devuelto (cantTransito), calculado
 * por getTecnicoLedger desde el libro de movimientos — la misma función que
 * usa la pestaña "Técnico" de Inventario para admin/jp/log, aquí acotada al
 * propio usuario.
 */
export function InventarioTecnicoScreen() {
  const userId = useAuth((s) => s.session?.user.id)
  const [rows, setRows] = useState<TecnicoLedgerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    getTecnicoLedger(userId).then(setRows).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [userId])

  const enPoder = (rows ?? []).filter((r) => r.cantTransito !== 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">📦 Mi inventario</h1>
        <p className="text-xs text-slate-400">Material que tienes en tu poder ahora mismo</p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {rows === null ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : enPoder.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">📦</div>
          <p className="text-sm">No tienes material entregado pendiente de instalar o devolver.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {enPoder.map((r) => (
            <div key={`${r.projectId ?? ''}|${r.materialId}|${r.lote}`} className="bg-slate-800 rounded-xl border border-slate-700 p-3 space-y-2">
              <div>
                <p className="text-sm text-white">{r.materialSku} — {r.materialDescripcion}</p>
                <p className="text-[11px] text-slate-500">
                  Lote {r.lote} · {r.projectOtt
                    ? `[${r.projectArea === 'ATT' ? 'ATT' : 'Preventivo'}] OTT ${r.projectOtt}`
                    : '🅿️ Sin proyecto (preventivo)'}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <Stat label="Entreg." value={r.cantEntregada} />
                <Stat label="Instal." value={r.cantInstalada} />
                <Stat label="Devuelto" value={r.cantDevuelta} />
                <Stat label="En tu poder" value={r.cantTransito} highlight={r.cantTransito > 0} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
