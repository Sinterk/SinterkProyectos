// Selector de código LPU con buscador — mismo patrón que MaterialSelect.tsx
// (portal a document.body, filtro por código/partida/descripción). Con ~305
// códigos un <select> nativo es impráctico. Los "ELIMINADO" se ocultan por
// defecto (siguen existiendo por si una línea vieja los referencia).

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LpuCodigo } from '@/lib/lpu/types'

interface Props {
  codigos: LpuCodigo[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
}

export function LpuCodigoSelect({ codigos, value, onChange, placeholder = 'Código LPU…', className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const disponibles = useMemo(
    () => codigos.filter((c) => (c.estado ?? '').trim().toLowerCase() !== 'eliminado'),
    [codigos],
  )
  const selected = codigos.find((c) => c.id === value) ?? null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? disponibles.filter((c) =>
        c.codigoAtt.toLowerCase().includes(q) ||
        (c.partida || '').toLowerCase().includes(q) ||
        c.descripcion.toLowerCase().includes(q))
    : disponibles

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 340) })
    }
    setQuery('')
    setOpen((v) => !v)
  }

  function select(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={className}>
      <button ref={btnRef} type="button" onClick={toggle}
        className="w-full text-left bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none truncate">
        {selected ? `${selected.codigoAtt} — ${selected.partida || selected.descripcion}` : <span className="text-slate-400">{placeholder}</span>}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-80 max-w-[90vw] bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 space-y-1.5">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar código, partida o descripción…"
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {filtered.length === 0 && <p className="text-xs text-slate-500 px-1 py-1">Sin coincidencias.</p>}
              {filtered.map((c) => (
                <button key={c.id} type="button" onClick={() => select(c.id)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-slate-700 ${c.id === value ? 'bg-brand-900/40 text-brand-300' : 'text-slate-200'}`}>
                  <div className="font-medium">{c.codigoAtt} — {c.partida || c.descripcion}</div>
                  {c.tipo && <div className="text-[10px] text-slate-500">{c.tipo}</div>}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
