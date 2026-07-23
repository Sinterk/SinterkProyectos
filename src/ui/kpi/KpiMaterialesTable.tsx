// Tabla de consumo de materiales del Panel de KPIs — mismas 7 columnas
// (Solicitado/Entregado/Instalado/Devuelto/Rebajado/Merma/Tránsito) tanto
// para la vista "por proyecto" (área ATT/OyM, sin filtro de bodega) como
// para la "ventana Inventario" (con bodega fija o elegible + técnicos) —
// ver KpiScreen. Los consumibles (identificados por bodega de origen, no
// por una columna propia en `materiales`) van en una sección aparte al
// final, solo con la columna Entregado.

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
  ubicacionId?: string | null
  tecnicoIds?: string[] | null
}

const COLUMNAS: { key: keyof KpiMaterialFila; label: string }[] = [
  { key: 'solicitado', label: 'Solicitado' },
  { key: 'entregado', label: 'Entregado' },
  { key: 'instalado', label: 'Instalado' },
  { key: 'devuelto', label: 'Devuelto' },
  { key: 'rebajado', label: 'Rebajado' },
  { key: 'merma', label: 'Merma' },
  { key: 'transito', label: 'Tránsito' },
]

export function KpiMaterialesTable({ titulo, area, subarea, desde, hasta, ubicacionId, tecnicoIds }: Props) {
  const [filas, setFilas] = useState<KpiMaterialFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFilas(null)
    setError(null)
    getKpiMateriales({ area, subarea, desde, hasta, ubicacionId, tecnicoIds })
      .then(setFilas)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [area, subarea, desde, hasta, ubicacionId, JSON.stringify(tecnicoIds ?? [])])

  const normales = filas?.filter((f) => !f.esConsumible) ?? []
  const consumibles = filas?.filter((f) => f.esConsumible) ?? []

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
                {COLUMNAS.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-medium text-center whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normales.map((f) => (
                <tr key={f.materialId} className="border-t border-slate-700 divide-x divide-slate-700">
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.sku}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.descripcion}</td>
                  {COLUMNAS.map((c) => (
                    <td key={c.key} className={`px-2 py-2 text-center whitespace-nowrap ${c.key === 'transito' && Number(f[c.key]) > 0 ? 'text-amber-400 font-semibold' : 'text-white'}`}>
                      {String(f[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {consumibles.length > 0 && (
                <>
                  <tr className="border-t border-slate-700 bg-slate-900/40">
                    <td colSpan={2 + COLUMNAS.length} className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                      Consumibles (total entregado)
                    </td>
                  </tr>
                  {consumibles.map((f) => (
                    <tr key={f.materialId} className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/40">
                      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">{f.sku}</td>
                      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">{f.descripcion}</td>
                      {COLUMNAS.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-center whitespace-nowrap text-slate-500">
                          {c.key === 'entregado' ? String(f.entregado) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
