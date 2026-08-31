// Selector de material con buscador — reemplaza el <select> nativo (que no
// se puede filtrar y con cientos de materiales SAP es difícil de usar).
// SKU se ordena numéricamente (ver src/lib/inventario/sku.ts), igual que en
// la tabla Bodega.
//
// El panel se porta a document.body con position:fixed en vez de vivir
// dentro del contenedor con position:absolute — usado dentro de una celda
// de tabla (ResumenProyectoTable, "+ Nuevo material"), quedaba recortado/
// tapando las filas de abajo por el mismo motivo que el filtro de columna
// de la pestaña Bodega (contenedor con overflow-x-auto).
//
// La posición NO se calcula desde el botón (`getBoundingClientRect` +
// coordenadas en px) — se probó así antes y en celular seguía dejando un
// espacio en blanco: cuando aparece el teclado, el navegador puede
// scrollear la página (para "acomodar" el input enfocado, o simplemente
// porque el visual viewport cambia de alto), y esas coordenadas fijas en
// px quedan desalineadas del contenido real apenas eso pasa. Ahora el panel
// se ancla directo al viewport (arriba, centrado) con CSS puro — no depende
// de dónde esté el botón ni de un cálculo hecho una sola vez al abrir, así
// que un scroll del navegador ya no lo puede dejar "perdido".
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
  const inputRef = useRef<HTMLInputElement>(null)

  // Enfoca el buscador al abrir sin `autoFocus`: en celular, `autoFocus`
  // hacía que el navegador scrolleara la página para "mostrar" el input
  // apenas se montaba (antes de que el panel llegara a su posición final),
  // agravando el problema de arriba. `preventScroll` corta ese scroll.
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
      <button type="button" onClick={toggle}
        className="w-full text-left bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none truncate">
        {selected ? `${selected.sku} — ${selected.apodo || selected.descripcion}` : <span className="text-slate-400">{placeholder}</span>}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div className="fixed z-50 top-3 left-1/2 -translate-x-1/2 w-[min(94vw,26rem)] max-h-[85vh] flex flex-col
            bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 gap-1.5">
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar SKU o nombre…"
              onClick={(e) => e.stopPropagation()}
              className="w-full shrink-0 bg-slate-700 text-white text-sm rounded-lg px-2 py-2 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <div className="overflow-y-auto space-y-1">
              {filtered.length === 0 && <p className="text-xs text-slate-500 px-1 py-1">Sin coincidencias.</p>}
              {filtered.map((m) => (
                <button key={m.id} type="button" onClick={() => select(m.id)}
                  className={`w-full text-left px-2 py-2 rounded hover:bg-slate-700 ${m.id === value ? 'bg-brand-900/40' : ''}`}>
                  <div className={`text-sm font-semibold ${m.id === value ? 'text-brand-300' : 'text-white'}`}>{m.sku}</div>
                  <div className="text-xs text-slate-300 leading-snug">{m.apodo || m.descripcion}</div>
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
