// Selector de material con buscador — reemplaza el <select> nativo (que no
// se puede filtrar y con cientos de materiales SAP es difícil de usar).
// SKU se ordena numéricamente (ver src/lib/inventario/sku.ts), igual que en
// la tabla Bodega.
//
// El panel se porta a document.body con position:fixed (posición calculada
// desde el botón al abrir) en vez de vivir dentro del contenedor con
// position:absolute — usado dentro de una celda de tabla (ResumenProyectoTable,
// "+ Nuevo material"), quedaba recortado/tapando las filas de abajo por el
// mismo motivo que el filtro de columna de la pestaña Bodega (contenedor con
// overflow-x-auto). Mismo fix que ese caso.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reportado en celular: al abrir el panel, el campo con autoFocus hacía
  // que el navegador scrolleara TODA la página para "mostrar el input
  // enfocado" — pero el panel ya está en position:fixed (para no quedar
  // recortado dentro de la tabla, ver arriba), así que ese scroll nativo
  // solo lograba correr el contenido real de la página a un área en blanco,
  // dejando la tabla fuera de vista. `preventScroll` corta ese scroll
  // automático — el panel ya se posiciona solo, no necesita que el
  // navegador "ayude" a centrarlo.
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  const sorted = useMemo(() => [...materiales].sort((a, b) => compareSku(a.sku, b.sku)), [materiales])
  const selected = materiales.find((m) => m.id === value) ?? null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter((m) => m.sku.toLowerCase().includes(q) || (m.apodo || m.descripcion).toLowerCase().includes(q))
    : sorted

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 300) })
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
        {selected ? `${selected.sku} — ${selected.apodo || selected.descripcion}` : <span className="text-slate-400">{placeholder}</span>}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-72 max-w-[90vw] bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 space-y-1.5">
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar SKU o nombre…"
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
        </>,
        document.body,
      )}
    </div>
  )
}
