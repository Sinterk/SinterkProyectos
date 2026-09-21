// Tabla del KPI de conciliación Físico vs Digital por SKU — ver el
// comentario largo en supabase/migrations/0073_kpi_conciliacion_sap.sql
// para la fórmula. A diferencia de KpiMaterialesTable, esto es un saldo
// VIVO (no pide periodo) — se recarga solo cuando cambian las bodegas.
//
// v1 a propósito simple (sin el filtro tipo Google Sheets de
// KpiMaterialesTable/ColumnHeader): el pedido fue "crea el KPI para luego
// afinar detalles en prueba y error" — ordenar por columna + buscar +
// mostrar solo descuadres alcanza para empezar a probarlo contra datos
// reales; se puede sumar el filtro por columna después si hace falta.

import { useEffect, useMemo, useState } from 'react'
import { getKpiConciliacionSap } from '@/lib/kpi/kpiRepo'
import type { KpiConciliacionFila } from '@/lib/kpi/kpiRepo'
import { compareSku } from '@/lib/inventario/sku'

interface Props {
  bodegasSapIds: string[]
  bodegaStkId: string | null
}

type ColKey = 'sku' | 'material' | 'fisicoBodegas' | 'fisicoTecnicos' | 'fisicoInstaladoAtt' | 'fisicoMerma'
  | 'fisicoTotal' | 'digitalSap' | 'diferenciaSap' | 'fisicoStk' | 'digitalStk' | 'diferenciaStk'

const COLUMNS: { key: ColKey; label: string; title?: string }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'material', label: 'Material' },
  { key: 'fisicoBodegas', label: 'Bodegas', title: 'Físico en bodegas SAP + STK' },
  { key: 'fisicoTecnicos', label: 'Técnicos', title: 'Físico en poder de técnicos (incluye tránsito de proyecto)' },
  { key: 'fisicoInstaladoAtt', label: 'Instalado ATT', title: 'Instalado en proyectos ATT activos, aún sin Rebajado' },
  { key: 'fisicoMerma', label: 'Merma', title: 'Merma acumulada — salió físico sin bajar digital' },
  { key: 'fisicoTotal', label: 'Físico total', title: 'Suma de las 4 columnas anteriores' },
  { key: 'digitalSap', label: 'Digital SAP' },
  { key: 'diferenciaSap', label: 'Diferencia SAP', title: 'Digital SAP − Físico total. Positivo = falta físico. Negativo = colchón.' },
  { key: 'fisicoStk', label: 'Físico STK' },
  { key: 'digitalStk', label: 'Digital STK', title: 'Basado en compras reportadas a Entel — no es SAP' },
  { key: 'diferenciaStk', label: 'Diferencia STK', title: 'Digital STK − Físico STK' },
]

const NUMERIC_COLS: ColKey[] = [
  'fisicoBodegas', 'fisicoTecnicos', 'fisicoInstaladoAtt', 'fisicoMerma', 'fisicoTotal',
  'digitalSap', 'diferenciaSap', 'fisicoStk', 'digitalStk', 'diferenciaStk',
]

function colValue(f: KpiConciliacionFila, key: ColKey): string | number {
  switch (key) {
    case 'sku': return f.sku
    case 'material': return f.descripcion
    case 'fisicoBodegas': return f.fisicoBodegas
    case 'fisicoTecnicos': return f.fisicoTecnicos
    case 'fisicoInstaladoAtt': return f.fisicoInstaladoAtt
    case 'fisicoMerma': return f.fisicoMerma
    case 'fisicoTotal': return f.fisicoTotal
    case 'digitalSap': return f.digitalSap
    case 'diferenciaSap': return f.diferenciaSap
    case 'fisicoStk': return f.fisicoStk
    case 'digitalStk': return f.digitalStk
    case 'diferenciaStk': return f.diferenciaStk
  }
}

export function KpiConciliacionSapTable({ bodegasSapIds, bodegaStkId }: Props) {
  const [filas, setFilas] = useState<KpiConciliacionFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [soloDescuadres, setSoloDescuadres] = useState(false)
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' }>({ key: 'diferenciaSap', dir: 'desc' })

  useEffect(() => {
    if (bodegasSapIds.length === 0 || !bodegaStkId) return
    setFilas(null)
    setError(null)
    getKpiConciliacionSap({ bodegasSapIds, bodegaStkId })
      .then(setFilas)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [JSON.stringify(bodegasSapIds), bodegaStkId])

  function onSort(key: ColKey) {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'sku' ? 'asc' : 'desc' })
  }

  const q = search.trim().toLowerCase()
  const rows = useMemo(() => {
    let out = (filas ?? []).filter((f) => !q || f.sku.toLowerCase().includes(q) || f.descripcion.toLowerCase().includes(q))
    if (soloDescuadres) out = out.filter((f) => f.diferenciaSap !== 0 || f.diferenciaStk !== 0)
    const sorted = [...out]
    sorted.sort((a, b) => {
      if (sort.key === 'sku') return compareSku(a.sku, b.sku, sort.dir)
      const va = colValue(a, sort.key)
      const vb = colValue(b, sort.key)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filas, q, soloDescuadres, sort])

  if (bodegasSapIds.length === 0 || !bodegaStkId) {
    return (
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4">
        <p className="text-xs text-slate-500">Faltan bodegas por configurar (C088/C103/C132/STK) — revisa que existan con esos nombres exactos en Inventario.</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Conciliación Físico vs Digital (SAP)</h2>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Saldo vivo, no por periodo. Diferencia positiva = falta físico para cuadrar con SAP. Negativa = colchón.
        </p>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!filas ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar SKU o material…"
              className="flex-1 min-w-[180px] bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <label className="flex items-center gap-1.5 text-xs text-slate-300 shrink-0">
              <input type="checkbox" checked={soloDescuadres} onChange={(e) => setSoloDescuadres(e.target.checked)} />
              Solo con diferencia
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                  {COLUMNS.map((col) => (
                    <th key={col.key} title={col.title} onClick={() => onSort(col.key)}
                      className="px-2 py-1.5 font-medium whitespace-nowrap cursor-pointer hover:text-white select-none">
                      {col.label}{sort.key === col.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={COLUMNS.length} className="px-2 py-3 text-center text-slate-500">Sin resultados.</td></tr>
                )}
                {rows.map((f) => (
                  <tr key={f.materialId} className="border-t border-slate-700 divide-x divide-slate-700">
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.sku}</td>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{f.descripcion}</td>
                    {NUMERIC_COLS.map((key) => {
                      const valor = colValue(f, key)
                      const esDiferencia = key === 'diferenciaSap' || key === 'diferenciaStk'
                      const colorCls = esDiferencia
                        ? (Number(valor) > 0 ? 'text-red-400 font-semibold' : Number(valor) < 0 ? 'text-emerald-400' : 'text-slate-500')
                        : 'text-white'
                      return (
                        <td key={key} className={`px-2 py-2 text-right whitespace-nowrap ${colorCls}`}>
                          {String(valor)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
