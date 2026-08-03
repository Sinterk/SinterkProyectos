// Catálogo de materiales (todos los SKU) — pedido explícito de Andrés: base
// de datos en formato tabla con SKU/Descripción/Nombre alternativo/Tipo/
// Proveedores. Ver supabase/migrations/0044_catalogo_materiales.sql.
// Nombre alternativo = el `apodo` que ya existía en el modelo pero no tenía
// forma de editarse desde la app (caso real: "ODF 12 fibras" ⇄ "CMIC").

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  listMateriales, listMaterialTipos, crearMaterialTipo,
  updateMaterialApodo, updateMaterialTipo, updateMaterialProveedores,
} from '@/lib/inventario/inventarioRepo'
import type { Material, MaterialTipo, ProveedorMaterial } from '@/lib/inventario/types'
import { PROVEEDORES_MATERIAL } from '@/lib/inventario/types'

const NUEVO_TIPO = '__nuevo__'

export function CatalogoMaterialesSection() {
  const [materiales, setMateriales] = useState<Material[] | null>(null)
  const [tipos, setTipos] = useState<MaterialTipo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  async function reload() {
    try {
      const [ms, ts] = await Promise.all([listMateriales(), listMaterialTipos()])
      setMateriales(ms)
      setTipos(ts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() }, [])

  const filtrados = useMemo(() => {
    if (!materiales) return null
    const query = q.trim().toLowerCase()
    if (!query) return materiales
    return materiales.filter((m) =>
      m.sku.toLowerCase().includes(query) ||
      m.descripcion.toLowerCase().includes(query) ||
      (m.apodo ?? '').toLowerCase().includes(query))
  }, [materiales, q])

  function actualizarLocal(materialId: string, cambios: Partial<Material>) {
    setMateriales((prev) => (prev ?? []).map((m) => (m.id === materialId ? { ...m, ...cambios } : m)))
  }

  async function crearYAsignarTipo(materialId: string, nombre: string) {
    try {
      const nuevo = await crearMaterialTipo(nombre)
      setTipos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      await updateMaterialTipo(materialId, nuevo.id)
      actualizarLocal(materialId, { tipoId: nuevo.id, tipo: nuevo })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Catálogo de materiales</h2>
        <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
          Todos los SKU: nombre alternativo (como se conoce en terreno), tipo (los de cable se consideran para el Estado de Pago) y proveedores.
        </p>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, descripción o nombre alternativo…"
        className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />

      {error && <p className="text-xs text-red-400">{error}</p>}

      {filtrados === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700 max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-slate-900 text-slate-400 text-left divide-x divide-slate-700">
                <th className="px-2 py-1.5">SKU</th>
                <th className="px-2 py-1.5">Descripción</th>
                <th className="px-2 py-1.5">Nombre alternativo</th>
                <th className="px-2 py-1.5">Tipo</th>
                <th className="px-2 py-1.5">Proveedores</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-500">Sin coincidencias.</td></tr>
              )}
              {filtrados.map((m) => (
                <FilaMaterial key={m.id} material={m} tipos={tipos}
                  onApodoChange={(apodo) => actualizarLocal(m.id, { apodo })}
                  onTipoChange={async (tipoId) => {
                    if (tipoId === NUEVO_TIPO) return
                    await updateMaterialTipo(m.id, tipoId || null)
                    actualizarLocal(m.id, { tipoId: tipoId || null, tipo: tipos.find((t) => t.id === tipoId) ?? null })
                  }}
                  onNuevoTipo={(nombre) => crearYAsignarTipo(m.id, nombre)}
                  onProveedoresChange={async (proveedores) => {
                    await updateMaterialProveedores(m.id, proveedores)
                    actualizarLocal(m.id, { proveedores })
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilaMaterial({ material, tipos, onApodoChange, onTipoChange, onNuevoTipo, onProveedoresChange }: {
  material: Material
  tipos: MaterialTipo[]
  onApodoChange: (apodo: string | null) => void
  onTipoChange: (tipoId: string) => void
  onNuevoTipo: (nombre: string) => void
  onProveedoresChange: (proveedores: ProveedorMaterial[]) => void
}) {
  const [apodo, setApodo] = useState(material.apodo ?? '')
  const [creandoTipo, setCreandoTipo] = useState(false)
  const [nombreNuevoTipo, setNombreNuevoTipo] = useState('')

  useEffect(() => { setApodo(material.apodo ?? '') }, [material.apodo])

  async function guardarApodo() {
    const valor = apodo.trim()
    if (valor === (material.apodo ?? '')) return
    await updateMaterialApodo(material.id, valor || null)
    onApodoChange(valor || null)
  }

  function elegirTipo(value: string) {
    if (value === NUEVO_TIPO) {
      setCreandoTipo(true)
      return
    }
    onTipoChange(value)
  }

  function confirmarNuevoTipo() {
    const nombre = nombreNuevoTipo.trim()
    if (!nombre) return
    onNuevoTipo(nombre)
    setNombreNuevoTipo('')
    setCreandoTipo(false)
  }

  return (
    <tr className="border-t border-slate-800">
      <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{material.sku}</td>
      <td className="px-2 py-1.5 text-slate-300">{material.descripcion}</td>
      <td className="px-2 py-1.5">
        <input value={apodo} onChange={(e) => setApodo(e.target.value)} onBlur={guardarApodo}
          placeholder="—" className="w-full bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      </td>
      <td className="px-2 py-1.5">
        {creandoTipo ? (
          <div className="flex gap-1">
            <input autoFocus value={nombreNuevoTipo} onChange={(e) => setNombreNuevoTipo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmarNuevoTipo(); if (e.key === 'Escape') setCreandoTipo(false) }}
              placeholder="Nombre del tipo…" className="w-28 bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <button type="button" onClick={confirmarNuevoTipo} className="text-brand-400 hover:text-brand-300 text-xs">✓</button>
            <button type="button" onClick={() => setCreandoTipo(false)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
          </div>
        ) : (
          <select value={material.tipoId ?? ''} onChange={(e) => elegirTipo(e.target.value)}
            className="w-36 bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
            <option value="">(vacío)</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            <option value={NUEVO_TIPO}>+ Nuevo tipo…</option>
          </select>
        )}
      </td>
      <td className="px-2 py-1.5">
        <ProveedoresSelect value={material.proveedores} onChange={onProveedoresChange} />
      </td>
    </tr>
  )
}

function ProveedoresSelect({ value, onChange }: { value: ProveedorMaterial[]; onChange: (v: ProveedorMaterial[]) => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    if (!open) {
      const r = e.currentTarget.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 200) })
    }
    setOpen((v) => !v)
  }

  function toggleProveedor(p: ProveedorMaterial) {
    const next = value.includes(p) ? value.filter((v) => v !== p) : [...value, p]
    onChange(next)
  }

  return (
    <div>
      <button type="button" onClick={toggle}
        className="w-full text-left bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none truncate">
        {value.length > 0 ? value.join(', ') : <span className="text-slate-500">—</span>}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-44 bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 space-y-1">
            {PROVEEDORES_MATERIAL.map((p) => (
              <label key={p} className="flex items-center gap-2 text-xs text-slate-200 px-1 py-1 rounded hover:bg-slate-700 cursor-pointer">
                <input type="checkbox" checked={value.includes(p)} onChange={() => toggleProveedor(p)} />
                {p}
              </label>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
