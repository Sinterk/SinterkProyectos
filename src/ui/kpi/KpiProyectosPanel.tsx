import { useEffect, useState } from 'react'
import { getKpiProyectosDetalle } from '@/lib/kpi/kpiRepo'
import type { KpiProyectoFila } from '@/lib/kpi/kpiRepo'
import { Stat } from '@/ui/ResumenProyectoTable'

interface Props {
  titulo: string
  area: 'ATT' | 'OyM'
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
}

const ESTADO_LABEL: Record<KpiProyectoFila['estado'], string> = {
  abierto: '🟢 Abierto', pendiente: '🟡 Pendiente', cerrado: '⚪ Cerrado',
}

export function KpiProyectosPanel({ titulo, area, subarea, desde, hasta }: Props) {
  const [filas, setFilas] = useState<KpiProyectoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFilas(null)
    setError(null)
    getKpiProyectosDetalle({ area, subarea, desde, hasta })
      .then(setFilas)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [area, subarea, desde, hasta])

  const abiertas = filas?.filter((f) => f.estado === 'abierto').length ?? 0
  const cerradas = filas?.filter((f) => f.estado === 'cerrado').length ?? 0
  const pendientes = filas?.filter((f) => f.estado === 'pendiente').length ?? 0

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">{titulo}</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!filas ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Abiertas" value={abiertas} />
            <Stat label="Cerradas" value={cerradas} />
            <Stat label="Pendientes" value={pendientes} highlight={pendientes > 0} />
          </div>
          {filas.length === 0 ? (
            <p className="text-xs text-slate-500">Sin proyectos en este periodo.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                    <th className="px-2 py-1.5 font-medium whitespace-nowrap">Proyecto</th>
                    <th className="px-2 py-1.5 font-medium whitespace-nowrap">Estado</th>
                    <th className="px-2 py-1.5 font-medium whitespace-nowrap">Fecha de inicio</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.projectId} className="border-t border-slate-700 divide-x divide-slate-700">
                      <td className="px-2 py-1.5 text-slate-200 whitespace-nowrap">{f.ott || 'Sin código'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ESTADO_LABEL[f.estado]}</td>
                      <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{f.fechaInicio}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
