// Selector de proyecto con buscador — mismo patrón que MaterialSelect.tsx/
// LpuCodigoSelect.tsx (portal a document.body, filtro de texto). Además
// permite crear un proyecto "base" al vuelo si el código escrito no
// coincide con ninguno existente (ver adminRepo.crearProyectoBase) — solo
// cuando `puedeCrear` es true, porque la RLS de `projects` solo permite
// insertar a admin/jp (rol log puede leer todos los proyectos pero no crear).

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary } from '@/lib/adminRepo'

interface Props {
  proyectos: ProjectSummary[]
  value: string
  onChange: (id: string) => void
  onCreated?: (nuevo: ProjectSummary) => void
  puedeCrear: boolean
  placeholder?: string
  className?: string
}

export function ProyectoSelect({ proyectos, value, onChange, onCreated, puedeCrear, placeholder = 'Elegir proyecto…', className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creando, setCreando] = useState<'ATT' | 'OyM' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Ver MaterialSelect.tsx: autoFocus + position:fixed hacía que el
  // navegador scrolleara la página entera al abrir en celular, dejando el
  // contenido real fuera de vista. `preventScroll` lo corta.
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  const selected = proyectos.find((p) => p.id === value) ?? null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? proyectos.filter((p) => p.ott.toLowerCase().includes(q) || (p.nombreProyecto ?? '').toLowerCase().includes(q))
    : proyectos
  const hayCoincidenciaExacta = proyectos.some((p) => p.ott.trim().toLowerCase() === q)
  const ofrecerCrear = puedeCrear && q.length > 0 && !hayCoincidenciaExacta

  function toggle() {
    setQuery('')
    setError(null)
    setCreando(null)
    setOpen((v) => !v)
  }

  function select(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  async function crear(area: 'ATT' | 'OyM') {
    setCreando(area)
    setError(null)
    try {
      const nuevo = await adminRepo.crearProyectoBase(query.trim(), area)
      onCreated?.(nuevo)
      select(nuevo.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreando(null)
    }
  }

  return (
    <div className={className}>
      <button type="button" onClick={toggle}
        className="w-full text-left bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none truncate">
        {selected
          ? `[${selected.area === 'ATT' ? 'ATT' : 'Preventivo'}] ${selected.ott || 'Sin código'}`
          : <span className="text-slate-400">{placeholder}</span>}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div className="fixed z-50 top-3 left-1/2 -translate-x-1/2 w-[min(94vw,26rem)] max-h-[85vh] flex flex-col
            bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 gap-1.5">
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar código o nombre…"
              onClick={(e) => e.stopPropagation()}
              className="w-full shrink-0 bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <div className="overflow-y-auto space-y-0.5">
              {filtered.length === 0 && !ofrecerCrear && <p className="text-xs text-slate-500 px-1 py-1">Sin coincidencias.</p>}
              {filtered.map((p) => (
                <button key={p.id} type="button" onClick={() => select(p.id)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-slate-700 ${p.id === value ? 'bg-brand-900/40 text-brand-300' : 'text-slate-200'}`}>
                  [{p.area === 'ATT' ? 'ATT' : 'Preventivo'}] {p.ott || 'Sin código'}{p.nombreProyecto ? ` — ${p.nombreProyecto}` : ''}
                </button>
              ))}
            </div>
            {ofrecerCrear && (
              <div className="border-t border-slate-700 pt-1.5 space-y-1">
                <p className="text-[10px] text-slate-500 px-1">No existe — crear "{query.trim()}" como:</p>
                <div className="flex gap-1.5">
                  <button type="button" disabled={!!creando} onClick={() => crear('ATT')}
                    className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40">
                    {creando === 'ATT' ? 'Creando…' : '+ ATT'}
                  </button>
                  <button type="button" disabled={!!creando} onClick={() => crear('OyM')}
                    className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40">
                    {creando === 'OyM' ? 'Creando…' : '+ Preventivo/Incidencia'}
                  </button>
                </div>
                {error && <p className="text-[10px] text-red-400 px-1">{error}</p>}
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
