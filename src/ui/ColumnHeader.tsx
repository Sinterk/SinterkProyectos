// Header de columna con orden + filtro tipo Google Sheets (checklist de
// valores únicos + buscador) — compartido por las tablas de Inventario
// (Bodega/Movimientos/Técnico, ver src/modules/inventario/components/Home.tsx)
// y las tablas del Panel de KPIs.

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ChecklistFilter {
  values: string[]
  selected: Set<string> | null // null = todo seleccionado (sin filtro)
  onToggleValue: (v: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
}

export function ColumnHeader<K extends string>({ col, sort, onSort, checklist, open, onToggle }: {
  col: { key: K; label: string; numeric?: boolean; align?: 'right' }
  sort: { key: K; dir: 'asc' | 'desc' } | null
  onSort: (dir: 'asc' | 'desc' | null) => void
  checklist: ChecklistFilter
  open: boolean
  onToggle: () => void
}) {
  const active = sort?.key === col.key
  const hasFilter = checklist.selected !== null
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // El popover se porta al <body> con position:fixed en vez de vivir dentro
  // del <th> (position:absolute): el contenedor de la tabla tiene
  // overflow-x-auto, y por una regla de CSS eso fuerza overflow-y a "auto"
  // también (no puede quedar "visible" en un solo eje) — con pocas filas
  // (ej. filtrando con "Ninguno") el contenedor queda bajo y recorta
  // cualquier hijo absoluto que se salga por abajo, dejando el menú
  // "escondido" a medias.
  function handleToggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 200) })
    }
    setSearch('')
    onToggle()
  }

  // El buscador solo tiene sentido si hay bastantes valores para hacer scroll (SKU/Material/Lote).
  const q = search.trim().toLowerCase()
  const visibleValues = q ? checklist.values.filter((v) => v.toLowerCase().includes(q)) : checklist.values

  return (
    <th className={`px-2 py-2 font-medium whitespace-nowrap relative ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
        <span>{col.label}</span>
        <button ref={btnRef} type="button" onClick={handleToggle}
          className={`text-[10px] leading-none rounded px-1 py-0.5 ${active || hasFilter ? 'text-brand-400' : 'text-slate-500 hover:text-slate-300'}`}>
          {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '▾'}
        </button>
      </div>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 space-y-1.5 text-left normal-case font-normal">
            <button type="button" onClick={() => onSort('asc')}
              className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-700 text-slate-200">
              {col.numeric ? '↑ Menor a mayor' : '↑ A → Z'}
            </button>
            <button type="button" onClick={() => onSort('desc')}
              className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-700 text-slate-200">
              {col.numeric ? '↓ Mayor a menor' : '↓ Z → A'}
            </button>
            {active && (
              <button type="button" onClick={() => onSort(null)}
                className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-700 text-slate-400">
                ✕ Quitar orden
              </button>
            )}
            <div className="border-t border-slate-700 pt-1.5 space-y-1">
              {checklist.values.length > 8 && (
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…" autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-slate-700 text-white text-[11px] rounded px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
              )}
              <div className="flex justify-between px-0.5">
                <button type="button" onClick={checklist.onSelectAll}
                  className="text-[10px] text-brand-400 hover:text-brand-300 font-semibold">Todo</button>
                <button type="button" onClick={checklist.onSelectNone}
                  className="text-[10px] text-brand-400 hover:text-brand-300 font-semibold">Ninguno</button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {visibleValues.length === 0 && <p className="text-[11px] text-slate-500 px-1 py-0.5">Sin coincidencias.</p>}
                {visibleValues.map((v) => (
                  <label key={v}
                    className="flex items-center gap-1.5 text-[11px] text-slate-200 px-1 py-0.5 rounded hover:bg-slate-700 cursor-pointer">
                    <input type="checkbox" checked={checklist.selected === null || checklist.selected.has(v)}
                      onChange={() => checklist.onToggleValue(v)} className="accent-brand-600" />
                    <span className="truncate">{v}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </th>
  )
}
