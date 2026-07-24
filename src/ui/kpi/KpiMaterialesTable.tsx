// Tabla de consumo de materiales del Panel de KPIs. `columnas='completas'`
// (default) muestra las 7 columnas estándar (Solicitado…Tránsito) + una
// columna de contexto + Físico/Digital cuando el padre pidió
// `stockUbicacionIds` (solo tiene sentido si el periodo termina hoy — ver
// KpiScreen). Esa columna de contexto cambia de significado según haya
// stock o no: sin stock es "Origen" (de qué bodega/técnico vino el
// movimiento, según `mostrarOrigenTecnico`); con stock pasa a ser "Bodega"
// (de qué bodega es ese Físico/Digital, siempre — aunque el material no se
// haya movido este periodo, para poder comparar consumo vs. disponible y
// decidir si conviene pedir más). `columnas='soloEntregado'` es la versión
// reducida que usa la tabla de Insumos: solo SKU/Material/Entregado.
//
// Buscador + filtro/orden por columna tipo Google Sheets, mismo patrón que
// las tablas de la ventana Inventario (ver ColumnHeader.tsx) — SKU se ordena
// por valor numérico, no alfabético (compareSku).

import { useEffect, useMemo, useState } from 'react'
import { getKpiMateriales } from '@/lib/kpi/kpiRepo'
import type { KpiMaterialFila } from '@/lib/kpi/kpiRepo'
import { ColumnHeader } from '@/ui/ColumnHeader'
import { compareSku } from '@/lib/inventario/sku'

interface Props {
  titulo: string
  /** null = todas las áreas combinadas (vista "solo inventario"). */
  area: 'ATT' | 'OyM' | null
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
  ubicacionIds?: string[] | null
  excluirUbicacionIds?: string[] | null
  tecnicoIds?: string[] | null
  stockUbicacionIds?: string[] | null
  /** true = la columna "Origen" muestra técnicos en vez de bodegas (vista "solo Inventario" por técnico). */
  mostrarOrigenTecnico?: boolean
  columnas?: 'completas' | 'soloEntregado'
}

type ColKey = 'sku' | 'material' | 'solicitado' | 'entregado' | 'instalado' | 'devuelto'
  | 'rebajado' | 'merma' | 'transito' | 'origen' | 'fisico' | 'digital'

const SIN_ORIGEN = 'Sin origen'
const SIN_BODEGA = 'Sin bodega'

export function KpiMaterialesTable({
  titulo, area, subarea, desde, hasta, ubicacionIds, excluirUbicacionIds, tecnicoIds,
  stockUbicacionIds, mostrarOrigenTecnico = false, columnas = 'completas',
}: Props) {
  const [filas, setFilas] = useState<KpiMaterialFila[] | null>(null)
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
    getKpiMateriales({ area, subarea, desde, hasta, ubicacionIds, excluirUbicacionIds, tecnicoIds, stockUbicacionIds })
      .then(setFilas)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [
    area, subarea, desde, hasta,
    JSON.stringify(ubicacionIds ?? []), JSON.stringify(excluirUbicacionIds ?? []),
    JSON.stringify(tecnicoIds ?? []), JSON.stringify(stockUbicacionIds ?? []),
  ])

  const soloEntregado = columnas === 'soloEntregado'
  const mostrarStock = !soloEntregado && !!stockUbicacionIds && stockUbicacionIds.length > 0

  const COLUMNS: { key: ColKey; label: string; numeric?: boolean; align?: 'right' }[] = useMemo(() => {
    const cols: { key: ColKey; label: string; numeric?: boolean; align?: 'right' }[] = [
      { key: 'sku', label: 'SKU', numeric: true },
      { key: 'material', label: 'Material' },
    ]
    if (soloEntregado) {
      cols.push({ key: 'entregado', label: 'Entregado', numeric: true, align: 'right' })
      return cols
    }
    cols.push(
      { key: 'solicitado', label: 'Solicitado', numeric: true, align: 'right' },
      { key: 'entregado', label: 'Entregado', numeric: true, align: 'right' },
      { key: 'instalado', label: 'Instalado', numeric: true, align: 'right' },
      { key: 'devuelto', label: 'Devuelto', numeric: true, align: 'right' },
      { key: 'rebajado', label: 'Rebajado', numeric: true, align: 'right' },
      { key: 'merma', label: 'Merma', numeric: true, align: 'right' },
      { key: 'transito', label: 'Tránsito', numeric: true, align: 'right' },
      // Con stock, esta columna deja de ser "de dónde vino el movimiento" y
      // pasa a ser "de qué bodega es este Físico/Digital" — para comparar
      // consumo del periodo contra la cantidad disponible y decidir si
      // conviene pedir más, hace falta saber de qué bodega es esa cantidad
      // aunque el material no se haya movido este periodo (ver colValue).
      { key: 'origen', label: mostrarStock ? 'Bodega' : 'Origen' },
    )
    if (mostrarStock) {
      cols.push(
        { key: 'fisico', label: 'Físico', numeric: true, align: 'right' },
        { key: 'digital', label: 'Digital', numeric: true, align: 'right' },
      )
    }
    return cols
  }, [soloEntregado, mostrarStock])

  function colValue(f: KpiMaterialFila, key: ColKey): string | number {
    switch (key) {
      case 'sku': return f.sku
      case 'material': return f.descripcion
      case 'solicitado': return f.solicitado
      case 'entregado': return f.entregado
      case 'instalado': return f.instalado
      case 'devuelto': return f.devuelto
      case 'rebajado': return f.rebajado
      case 'merma': return f.merma
      case 'transito': return f.transito
      case 'origen': return (mostrarStock ? f.bodegaStock : (mostrarOrigenTecnico ? f.origenTecnico : f.origenBodega)) ?? ''
      case 'fisico': return f.fisico ?? 0
      case 'digital': return f.digital ?? 0
    }
  }

  /** Texto para el checklist de filtro (los campos vacíos se ven como "Sin origen"/"Sin bodega", no como cadena vacía). */
  function colDisplayValue(f: KpiMaterialFila, key: ColKey): string {
    if (key === 'origen') {
      if (mostrarStock) return f.bodegaStock || SIN_BODEGA
      return (mostrarOrigenTecnico ? f.origenTecnico : f.origenBodega) || SIN_ORIGEN
    }
    return String(colValue(f, key))
  }

  const NUMERIC_COLS: ColKey[] = ['solicitado', 'entregado', 'instalado', 'devuelto', 'rebajado', 'merma', 'transito', 'fisico', 'digital']

  function sortColumnValues(key: ColKey, values: string[]): string[] {
    if (key === 'sku') return [...values].sort((a, b) => compareSku(a, b, 'asc'))
    if (NUMERIC_COLS.includes(key)) return [...values].sort((a, b) => Number(a) - Number(b))
    return [...values].sort((a, b) => a.localeCompare(b))
  }

  const q = search.trim().toLowerCase()
  const searched = (filas ?? []).filter((f) => !q
    || f.sku.toLowerCase().includes(q)
    || f.descripcion.toLowerCase().includes(q)
    || (colDisplayValue(f, 'origen')).toLowerCase().includes(q))

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<ColKey, string[]>
    for (const col of COLUMNS) {
      result[col.key] = sortColumnValues(col.key, [...new Set(searched.map((f) => colDisplayValue(f, col.key)))])
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, COLUMNS])

  const displayRows = useMemo(() => {
    let out = searched
    for (const key of Object.keys(colSelected) as ColKey[]) {
      const set = colSelected[key]
      if (!set) continue
      out = out.filter((f) => set.has(colDisplayValue(f, key)))
    }
    if (!sort) return out
    const sorted = [...out]
    sorted.sort((a, b) => {
      if (sort.key === 'sku') return compareSku(a.sku, b.sku, sort.dir)
      const va = colValue(a, sort.key)
      const vb = colValue(b, sort.key)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, colSelected, sort])

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">{titulo}</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!filas ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="text-xs text-slate-500">Sin movimientos en este periodo.</p>
      ) : (
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={mostrarStock ? 'Buscar SKU, material o bodega…' : 'Buscar SKU, material u origen…'}
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
                  <tr key={f.materialId} className="border-t border-slate-700 divide-x divide-slate-700">
                    {COLUMNS.map((col) => {
                      if (col.key === 'sku') return <td key={col.key} className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.sku}</td>
                      if (col.key === 'material') return <td key={col.key} className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.descripcion}</td>
                      if (col.key === 'origen') return (
                        <td key={col.key} className="px-2 py-2 text-slate-400 whitespace-nowrap">
                          {(mostrarStock ? f.bodegaStock : (mostrarOrigenTecnico ? f.origenTecnico : f.origenBodega)) ?? '—'}
                        </td>
                      )
                      const valor = colValue(f, col.key)
                      return (
                        <td key={col.key} className={`px-2 py-2 text-center whitespace-nowrap ${col.key === 'transito' && Number(valor) > 0 ? 'text-amber-400 font-semibold' : 'text-white'}`}>
                          {String(valor)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
