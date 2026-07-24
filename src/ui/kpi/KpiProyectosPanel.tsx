import { useEffect, useMemo, useState } from 'react'
import { getKpiProyectosDetalle } from '@/lib/kpi/kpiRepo'
import type { KpiProyectoFila } from '@/lib/kpi/kpiRepo'
import { ColumnHeader } from '@/ui/ColumnHeader'
import { Stat } from '@/ui/ResumenProyectoTable'

interface Props {
  titulo: string
  area: 'ATT' | 'OyM'
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
}

const ESTADO_LABEL: Record<KpiProyectoFila['estado'], string> = {
  abierto: '🟢 Abierto', pendiente: '🟡 Pendiente', cerrado: '⚪ Cerrado',
}
const ESTADO_ORDEN: Record<KpiProyectoFila['estado'], number> = { abierto: 0, pendiente: 1, cerrado: 2 }

type ColKey = 'proyecto' | 'estado' | 'fecha'
const COLUMNS: { key: ColKey; label: string; numeric?: boolean }[] = [
  { key: 'proyecto', label: 'Proyecto' },
  { key: 'estado', label: 'Estado' },
  { key: 'fecha', label: 'Fecha de inicio' },
]

function colValue(f: KpiProyectoFila, key: ColKey): string {
  switch (key) {
    case 'proyecto': return f.ott || 'Sin código'
    case 'estado': return ESTADO_LABEL[f.estado]
    case 'fecha': return f.fechaInicio
  }
}

function sortColumnValues(key: ColKey, values: string[]): string[] {
  if (key === 'fecha') return [...values].sort((a, b) => a.localeCompare(b))
  return [...values].sort((a, b) => a.localeCompare(b))
}

export function KpiProyectosPanel({ titulo, area, subarea, desde, hasta }: Props) {
  const [filas, setFilas] = useState<KpiProyectoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' } | null>(null)
  const [colSelected, setColSelected] = useState<Partial<Record<ColKey, Set<string>>>>({})
  const [openMenu, setOpenMenu] = useState<ColKey | null>(null)

  useEffect(() => {
    setFilas(null)
    setError(null)
    setSearch('')
    setSort(null)
    setColSelected({})
    getKpiProyectosDetalle({ area, subarea, desde, hasta })
      .then(setFilas)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [area, subarea, desde, hasta])

  const abiertas = filas?.filter((f) => f.estado === 'abierto').length ?? 0
  const cerradas = filas?.filter((f) => f.estado === 'cerrado').length ?? 0
  const pendientes = filas?.filter((f) => f.estado === 'pendiente').length ?? 0

  const q = search.trim().toLowerCase()
  const searched = (filas ?? []).filter((f) => !q || (f.ott || '').toLowerCase().includes(q))

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<ColKey, string[]>
    for (const col of COLUMNS) {
      result[col.key] = sortColumnValues(col.key, [...new Set(searched.map((f) => colValue(f, col.key)))])
    }
    return result
  }, [searched])

  const displayRows = useMemo(() => {
    let out = searched
    for (const key of Object.keys(colSelected) as ColKey[]) {
      const set = colSelected[key]
      if (!set) continue
      out = out.filter((f) => set.has(colValue(f, key)))
    }
    if (!sort) {
      // Orden por defecto de la BD: Abierto, Pendiente, Cerrado; dentro de cada grupo, por fecha ascendente.
      return [...out].sort((a, b) => ESTADO_ORDEN[a.estado] - ESTADO_ORDEN[b.estado] || a.fechaInicio.localeCompare(b.fechaInicio))
    }
    const sorted = [...out]
    sorted.sort((a, b) => {
      const cmp = colValue(a, sort.key).localeCompare(colValue(b, sort.key))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [searched, colSelected, sort])

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">{titulo}</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!filas ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Abiertas" value={abiertas} />
            <Stat label="Cerradas" value={cerradas} />
            <Stat label="Pendientes" value={pendientes} highlight={pendientes > 0} />
          </div>
          {filas.length === 0 ? (
            <p className="text-xs text-slate-500">Sin proyectos en este periodo.</p>
          ) : (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proyecto…"
                className="w-full bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                      {COLUMNS.map((col) => {
                        const colValues = valuesByColumn[col.key]
                        const colSelectedSet = colSelected[col.key]
                        return (
                          <ColumnHeader key={col.key} col={col}
                            sort={sort} onSort={(dir) => { setSort(dir ? { key: col.key, dir } : null); setOpenMenu(null) }}
                            checklist={{
                              values: colValues,
                              selected: colSelectedSet ?? null,
                              onToggleValue: (v) => setColSelected((prev) => {
                                const current = new Set(prev[col.key] ?? colValues)
                                if (current.has(v)) current.delete(v); else current.add(v)
                                const next = { ...prev }
                                if (current.size === colValues.length) delete next[col.key]
                                else next[col.key] = current
                                return next
                              }),
                              onSelectAll: () => setColSelected((prev) => {
                                const next = { ...prev }
                                delete next[col.key]
                                return next
                              }),
                              onSelectNone: () => setColSelected((prev) => ({ ...prev, [col.key]: new Set() })),
                            }}
                            open={openMenu === col.key} onToggle={() => setOpenMenu((k) => (k === col.key ? null : col.key))} />
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.length === 0 && (
                      <tr><td colSpan={COLUMNS.length} className="px-2 py-3 text-center text-slate-500">
                        Ningún resultado con los filtros de columna actuales.
                      </td></tr>
                    )}
                    {displayRows.map((f) => (
                      <tr key={f.projectId} className="border-t border-slate-700 divide-x divide-slate-700">
                        <td className="px-2 py-1.5 text-slate-200 whitespace-nowrap">{f.ott || 'Sin código'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{ESTADO_LABEL[f.estado]}</td>
                        <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{f.fechaInicio}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
