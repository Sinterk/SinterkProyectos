import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { attRepo } from '@/modules/att/data/attRepo'
import { preventivoRepo } from '@/modules/preventivos/data/preventivoRepo'
import { incidenciaRepo } from '@/modules/incidencias/data/incidenciaRepo'

interface Asignacion {
  area: 'ATT' | 'Preventivo' | 'Incidencia'
  id: string
  codigo: string
  nombre: string | null
  comuna: string | null
}

/**
 * Home del rol técnico: proyectos ATT + Preventivos + Incidencias donde está
 * asignado (project_members). No hace falta filtrar por técnico en la
 * query — la RLS de `projects` ya solo devuelve lo suyo (is_member()).
 */
export function AsignacionesScreen() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Asignacion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      attRepo.list({ estado: 'activo' }),
      preventivoRepo.list({ estado: 'activo' }),
      incidenciaRepo.list({ estado: 'activo' }),
    ])
      .then(([att, prev, inc]) => {
        const merged: Asignacion[] = [
          ...att.map((r) => ({
            area: 'ATT' as const, id: r.id,
            codigo: r.ott || 'Sin código', nombre: r.nombreProyecto || null, comuna: r.comuna || null,
          })),
          ...prev.map((r) => ({
            area: 'Preventivo' as const, id: r.id,
            codigo: r.cuadrante.cuadrante || 'Sin código', nombre: r.cuadrante.nombreCuadrante || null, comuna: r.cuadrante.comuna || null,
          })),
          ...inc.map((r) => ({
            area: 'Incidencia' as const, id: r.id,
            codigo: r.codigo || 'Sin código', nombre: r.ingeniero || null, comuna: r.direccion || null,
          })),
        ]
        merged.sort((a, b) => a.area.localeCompare(b.area) || a.codigo.localeCompare(b.codigo))
        setItems(merged)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  function open(a: Asignacion) {
    if (a.area === 'ATT') navigate(`/att/${a.id}`)
    else if (a.area === 'Preventivo') navigate(`/preventivos/${a.id}`)
    else navigate(`/incidencias/${a.id}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">📋 Mis asignaciones</h1>
        <p className="text-xs text-slate-400">Proyectos donde estás asignado como técnico</p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {items === null ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🗂️</div>
          <p className="text-sm">Todavía no tienes proyectos asignados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <button
              key={`${a.area}-${a.id}`}
              type="button"
              onClick={() => open(a)}
              className="w-full bg-slate-800 rounded-2xl border border-slate-700 hover:border-brand-500 p-4 text-left transition-colors"
            >
              <span className="text-[10px] font-medium text-brand-400 uppercase tracking-wide">{a.area}</span>
              <div className="text-sm font-semibold text-white mt-1">{a.codigo}</div>
              {a.nombre && <div className="text-xs text-slate-300 mt-0.5 truncate">{a.nombre}</div>}
              {a.comuna && <div className="text-xs text-slate-400 mt-0.5">📍 {a.comuna}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
