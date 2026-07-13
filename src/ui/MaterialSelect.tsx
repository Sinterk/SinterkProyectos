// Selector de material con buscador — reemplaza el <select> nativo (que no
// se puede filtrar y con cientos de materiales SAP es difícil de usar).
// SKU se ordena numéricamente (ver src/lib/inventario/sku.ts), igual que en
// la tabla Bodega.

import { useMemo, useState } from 'react'
import { compareSku } from '@/lib/inventario/sku'
import type { Material } from '@/lib/inventario/types'

interface Props {
  materiales: Material[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
}

export function MaterialSelect({ materiales, value, onChange, placeholder = 'Material…', className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const sorted = useMemo(() => [...materiales].sort((a, b) => compareSku(a.sku, b.sku)), [materiales])
  const selected = materiales.find((m) => m.id === value) ?? null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter((m) => m.sku.toLowerCase().includes(q) || (m.apodo || m.descripcion).toLowerCase().includes(q))
    : sorted

  function select(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full text-left bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none truncate">
        {selected ? `${selected.sku} — ${selected.apodo || selected.descripcion}` : <span className="text-slate-400">{placeholder}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full mt-1 left-0 w-72 max-w-[90vw] bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 space-y-1.5">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar SKU o nombre…"
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {filtered.length === 0 && <p className="text-xs text-slate-500 px-1 py-1">Sin coincidencias.</p>}
              {filtered.map((m) => (
                <button key={m.id} type="button" onClick={() => select(m.id)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-slate-700 ${m.id === value ? 'bg-brand-900/40 text-brand-300' : 'text-slate-200'}`}>
                  {m.sku} — {m.apodo || m.descripcion}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
