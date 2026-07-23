import { useEffect, useState } from 'react'
import { getKpiProyectos } from '@/lib/kpi/kpiRepo'
import { Stat } from '@/ui/ResumenProyectoTable'

interface Props {
  titulo: string
  area: 'ATT' | 'OyM'
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
}

export function KpiProyectosPanel({ titulo, area, subarea, desde, hasta }: Props) {
  const [resumen, setResumen] = useState<{ abiertas: number; cerradas: number; pendientes: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResumen(null)
    setError(null)
    getKpiProyectos({ area, subarea, desde, hasta })
      .then(setResumen)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [area, subarea, desde, hasta])

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">{titulo}</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!resumen ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Abiertas" value={resumen.abiertas} />
          <Stat label="Cerradas" value={resumen.cerradas} />
          <Stat label="Pendientes" value={resumen.pendientes} highlight={resumen.pendientes > 0} />
        </div>
      )}
    </div>
  )
}
