// Tabla de consumo de materiales del Panel de KPIs. `columnas='completas'`
// (default) muestra las 7 columnas estándar (Solicitado…Tránsito) + Origen
// (bodega o técnico, según `mostrarOrigenTecnico`) + Físico/Digital cuando
// el padre pidió `stockUbicacionIds` (solo tiene sentido si el periodo
// termina hoy — ver KpiScreen). `columnas='soloEntregado'` es la versión
// reducida que usa la tabla de Insumos: solo SKU/Material/Entregado.

import { useEffect, useState } from 'react'
import { getKpiMateriales } from '@/lib/kpi/kpiRepo'
import type { KpiMaterialFila } from '@/lib/kpi/kpiRepo'

interface Props {
  titulo: string
  /** null = todas las áreas combinadas (vista "solo inventario"). */
  area: 'ATT' | 'OyM' | null
  subarea?: 'preventivo' | 'incidencia' | null
  desde: string
  hasta: string
  ubicacionIds?: string[] | null
  excluirUbicacionIds?: string[] | null
  tecnicoIds?: string[] | null
  stockUbicacionIds?: string[] | null
  /** true = la columna "Origen" muestra técnicos en vez de bodegas (vista "solo Inventario" por técnico). */
  mostrarOrigenTecnico?: boolean
  columnas?: 'completas' | 'soloEntregado'
}

const COLUMNAS_BASE: { key: keyof KpiMaterialFila; label: string }[] = [
  { key: 'solicitado', label: 'Solicitado' },
  { key: 'entregado', label: 'Entregado' },
  { key: 'instalado', label: 'Instalado' },
  { key: 'devuelto', label: 'Devuelto' },
  { key: 'rebajado', label: 'Rebajado' },
  { key: 'merma', label: 'Merma' },
  { key: 'transito', label: 'Tránsito' },
]

export function KpiMaterialesTable({
  titulo, area, subarea, desde, hasta, ubicacionIds, excluirUbicacionIds, tecnicoIds,
  stockUbicacionIds, mostrarOrigenTecnico = false, columnas = 'completas',
}: Props) {
  const [filas, setFilas] = useState<KpiMaterialFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFilas(null)
    setError(null)
    getKpiMateriales({ area, subarea, desde, hasta, ubicacionIds, excluirUbicacionIds, tecnicoIds, stockUbicacionIds })
      .then(setFilas)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [
    area, subarea, desde, hasta,
    JSON.stringify(ubicacionIds ?? []), JSON.stringify(excluirUbicacionIds ?? []),
    JSON.stringify(tecnicoIds ?? []), JSON.stringify(stockUbicacionIds ?? []),
  ])

  const soloEntregado = columnas === 'soloEntregado'
  const mostrarStock = !soloEntregado && !!stockUbicacionIds && stockUbicacionIds.length > 0

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">{titulo}</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!filas ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="text-xs text-slate-500">Sin movimientos en este periodo.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                <th className="px-2 py-2 font-medium whitespace-nowrap">SKU</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">Material</th>
                {soloEntregado ? (
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Entregado</th>
                ) : (
                  <>
                    {COLUMNAS_BASE.map((c) => (
                      <th key={c.key} className="px-2 py-2 font-medium text-center whitespace-nowrap">{c.label}</th>
                    ))}
                    <th className="px-2 py-2 font-medium whitespace-nowrap">Origen</th>
                    {mostrarStock && (
                      <>
                        <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Físico</th>
                        <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Digital</th>
                      </>
                    )}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.materialId} className="border-t border-slate-700 divide-x divide-slate-700">
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.sku}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.descripcion}</td>
                  {soloEntregado ? (
                    <td className="px-2 py-2 text-center whitespace-nowrap text-white">{f.entregado}</td>
                  ) : (
                    <>
                      {COLUMNAS_BASE.map((c) => (
                        <td key={c.key} className={`px-2 py-2 text-center whitespace-nowrap ${c.key === 'transito' && Number(f[c.key]) > 0 ? 'text-amber-400 font-semibold' : 'text-white'}`}>
                          {String(f[c.key])}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">
                        {(mostrarOrigenTecnico ? f.origenTecnico : f.origenBodega) ?? '—'}
                      </td>
                      {mostrarStock && (
                        <>
                          <td className="px-2 py-2 text-center whitespace-nowrap text-white">{f.fisico ?? 0}</td>
                          <td className="px-2 py-2 text-center whitespace-nowrap text-white">{f.digital ?? 0}</td>
                        </>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
