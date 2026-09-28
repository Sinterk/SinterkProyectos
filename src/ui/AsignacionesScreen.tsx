import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { attRepo, isUuid } from '@/modules/att/data/attRepo'
import { preventivoRepo } from '@/modules/preventivos/data/preventivoRepo'
import { incidenciaRepo } from '@/modules/incidencias/data/incidenciaRepo'
import { AttCard } from '@/modules/att/components/Home'
import { CuadranteCard } from '@/modules/preventivos/components/Home'
import { IncidenciaCard } from '@/modules/incidencias/components/Home'
import { getTotalesMaterialPorProyecto } from '@/lib/inventario/inventarioRepo'
import type { TotalesMaterialProyecto } from '@/lib/inventario/inventarioRepo'
import type { AttRecord } from '@/modules/att/types'
import type { Preventivo } from '@/modules/preventivos/types'
import type { Incidencia } from '@/modules/incidencias/types'

/**
 * Home del rol técnico: proyectos ATT + Preventivos + Incidencias donde está
 * asignado (project_members). No hace falta filtrar por técnico en la
 * query — la RLS de `projects` ya solo devuelve lo suyo (is_member()).
 *
 * Reusa las mismas tarjetas (AttCard/CuadranteCard/IncidenciaCard) y el mismo
 * orden (updatedAt desc) que la vista de oficina de cada módulo, en vez de
 * una tarjeta simplificada propia — así el técnico ve la misma info
 * (dirección, fecha, material, fotos, etc.), sin duplicar el diseño de cada
 * tarjeta en dos lugares. Sin botón de eliminar: acá no se expone esa acción.
 */
export function AsignacionesScreen() {
  const navigate = useNavigate()
  const [att, setAtt] = useState<AttRecord[] | null>(null)
  const [prev, setPrev] = useState<Preventivo[] | null>(null)
  const [inc, setInc] = useState<Incidencia[] | null>(null)
  const [totales, setTotales] = useState<Record<string, TotalesMaterialProyecto>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      attRepo.list({ estado: 'activo' }),
      preventivoRepo.list({ estado: 'activo' }),
      incidenciaRepo.list({ estado: 'activo' }),
    ])
      .then(([attList, prevList, incList]) => {
        setAtt([...attList].sort((a, b) => b.updatedAt - a.updatedAt))
        setPrev([...prevList].sort((a, b) => b.updatedAt - a.updatedAt))
        setInc([...incList].sort((a, b) => b.updatedAt - a.updatedAt))
        const ids = attList.filter((r) => isUuid(r.id)).map((r) => r.id)
        getTotalesMaterialPorProyecto(ids).then(setTotales).catch(() => setTotales({}))
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const loading = att === null || prev === null || inc === null
  const total = (att?.length ?? 0) + (prev?.length ?? 0) + (inc?.length ?? 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-white">📋 Mis asignaciones</h1>
        <p className="text-xs text-slate-400">Proyectos donde estás asignado como técnico</p>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : total === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🗂️</div>
          <p className="text-sm">Todavía no tienes proyectos asignados.</p>
        </div>
      ) : (
        <>
          {att!.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">🔧 ATT</h2>
              <div className="space-y-3">
                {att!.map((r) => (
                  <AttCard key={r.id} record={r} totales={totales[r.id]} onSelect={() => navigate(`/att/${r.id}`)} />
                ))}
              </div>
            </section>
          )}

          {prev!.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">📡 Preventivos</h2>
              <div className="space-y-3">
                {prev!.map((r) => (
                  <CuadranteCard key={r.id} record={r} onSelect={() => navigate(`/preventivos/${r.id}`)} />
                ))}
              </div>
            </section>
          )}

          {inc!.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">🚨 Incidencias</h2>
              <div className="space-y-3">
                {inc!.map((r) => (
                  <IncidenciaCard key={r.id} record={r} onSelect={() => navigate(`/incidencias/${r.id}`)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
