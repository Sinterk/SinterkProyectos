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
import { listPaquetes } from '@/lib/inventario/inventarioRepo'
import { compareSku } from '@/lib/inventario/sku'
import type { Material, Paquete } from '@/lib/inventario/types'

interface Props {
  materiales: Material[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  /**
   * Se llama en vez de `onChange` cuando el usuario elige un paquete
   * (Catálogo → Paquetes de materiales, ver 0069_paquetes_material.sql):
   * entrega TODOS los material_id del paquete, sin cantidad — quien arma el
   * selector decide cómo expandirlos (ej. una línea nueva por SKU). Si no
   * se pasa, los paquetes simplemente no se ofrecen (ver `sinPaquetes`).
   */
  onSelectPaquete?: (materialIds: string[]) => void
  /** Oculta los paquetes del listado — se usa donde elegir un paquete no tendría sentido (ej. el propio editor de paquetes en Catálogo). */
  sinPaquetes?: boolean
}

export function MaterialSelect({ materiales, value, onChange, placeholder = 'Material…', className, onSelectPaquete, sinPaquetes }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [paquetes, setPaquetes] = useState<Paquete[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Enfoca el buscador al abrir sin `autoFocus`: en celular, `autoFocus`
  // hacía que el navegador scrolleara la página para "mostrar" el input
  // apenas se montaba (antes de que el panel llegara a su posición final),
  // agravando el problema de arriba. `preventScroll` corta ese scroll.
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  // Un fetch propio por instancia (mismo patrón que LoteSelect con
  // getStock) en vez de pedirle la lista a cada pantalla que usa este
  // selector — son unas pocas filas, y así "todas las instancias" la
  // ofrecen sin tener que enchufar un prop nuevo en cada una.
  useEffect(() => {
    if (sinPaquetes || !onSelectPaquete) return
    listPaquetes().then(setPaquetes).catch(() => {})
  }, [sinPaquetes, onSelectPaquete])

  const sorted = useMemo(() => [...materiales].sort((a, b) => compareSku(a.sku, b.sku)), [materiales])
  const selected = materiales.find((m) => m.id === value) ?? null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter((m) => m.sku.toLowerCase().includes(q) || (m.apodo || m.descripcion).toLowerCase().includes(q))
    : sorted
  // Al final de la lista, después de los SKU sueltos — pedido explícito de
  // Andrés ("debe estar al final después de los sku").
  const paquetesFiltrados = q ? paquetes.filter((p) => p.nombre.toLowerCase().includes(q)) : paquetes

  function toggle() {
    setQuery('')
    setOpen((v) => !v)
  }

  function select(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function selectPaquete(p: Paquete) {
    onSelectPaquete?.(p.materialIds)
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
              {filtered.length === 0 && paquetesFiltrados.length === 0 && <p className="text-xs text-slate-500 px-1 py-1">Sin coincidencias.</p>}
              {filtered.map((m) => (
                <button key={m.id} type="button" onClick={() => select(m.id)}
                  className={`w-full text-left px-2 py-2 rounded hover:bg-slate-700 ${m.id === value ? 'bg-brand-900/40' : ''}`}>
                  <div className={`text-sm font-semibold ${m.id === value ? 'text-brand-300' : 'text-white'}`}>{m.sku}</div>
                  <div className="text-xs text-slate-300 leading-snug">{m.apodo || m.descripcion}</div>
                </button>
              ))}
              {/* Paquetes al final, después de los SKU sueltos (ver Catálogo →
                  Paquetes de materiales) — elegir uno agrega TODOS sus SKU sin
                  cantidad, no reemplaza esta selección por un solo material. */}
              {paquetesFiltrados.map((p) => (
                <button key={p.id} type="button" onClick={() => selectPaquete(p)}
                  className="w-full text-left px-2 py-2 rounded hover:bg-slate-700 border-t border-slate-700 first:border-t-0">
                  <div className="text-sm font-semibold text-amber-300">📦 {p.nombre}</div>
                  <div className="text-xs text-slate-400 leading-snug">Paquete — agrega {p.materialIds.length} SKU</div>
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
