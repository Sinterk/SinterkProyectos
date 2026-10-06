// "Ventana nueva" (modal) para exportar el stock a Excel — pedido de Andrés:
// elegir bodega(s) + Físico/Digital/Ambos, botón en Inventario > Stock. Mismo
// patrón de modal que ZipArchiveViewer.tsx (overlay fixed + tarjeta centrada).
import { useEffect, useState } from 'react'
import { getMaterialOttsAbiertas, getStock, listUbicaciones } from '@/lib/inventario/inventarioRepo'
import type { StockRow, Ubicacion } from '@/lib/inventario/types'
import { generarStockExcel } from '../utils/generarStockExcel'
import type { NaturalezaExport } from '../utils/generarStockExcel'

export function ExportarStockExcelButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:border-brand-500 hover:text-white transition-colors shrink-0">
        📊 Exportar a Excel
      </button>
      {open && <ExportarStockExcelModal onClose={() => setOpen(false)} />}
    </>
  )
}

function ExportarStockExcelModal({ onClose }: { onClose: () => void }) {
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [naturaleza, setNaturaleza] = useState<NaturalezaExport>('ambos')
  const [incluirOtt, setIncluirOtt] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Todas seleccionadas por defecto — lo más común es exportar todo y filtrar
  // en Excel después; destildar es más rápido que tildar una por una.
  useEffect(() => {
    listUbicaciones({ tipo: 'bodega' })
      .then((bs) => { setBodegas(bs); setSeleccionadas(new Set(bs.map((b) => b.id))) })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  function toggleBodega(id: string) {
    setSeleccionadas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleTodas() {
    setSeleccionadas((prev) => (prev.size === bodegas.length ? new Set() : new Set(bodegas.map((b) => b.id))))
  }

  async function generar() {
    if (seleccionadas.size === 0) { setError('Elige al menos una bodega'); return }
    setGenerando(true)
    setError(null)
    try {
      // Una sola consulta a todo el stock de bodegas, filtrada acá a las
      // elegidas — más simple que una consulta por bodega y el volumen de
      // stock de bodega nunca es tan grande como para que importe.
      const todas: StockRow[] = await getStock({ soloBodega: true })
      const rows = todas.filter((r) => seleccionadas.has(r.ubicacionId))
      const bodegasLabel = seleccionadas.size === bodegas.length
        ? 'todas'
        : bodegas.filter((b) => seleccionadas.has(b.id)).map((b) => b.nombre).join('_')
      const materialOtts = incluirOtt ? await getMaterialOttsAbiertas() : undefined
      const r = generarStockExcel(rows, naturaleza, bodegasLabel, materialOtts)
      // Digital: lo que está en lotes 'SinDefinir'/'Físico' no se exporta — se avisa para que no pase desapercibido.
      if (r.omitidasSinLote.filas > 0) {
        setAviso(`Excel generado (${r.filas} filas${incluirOtt ? ` + ${r.filasOtt} en la hoja de OTT` : ''}). No se incluyeron ${r.omitidasSinLote.filas} fila(s) con digital en lote SinDefinir/Físico (${r.omitidasSinLote.unidades} unidades en total).`)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">📊 Exportar stock a Excel</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Bodegas</span>
            <button type="button" onClick={toggleTodas} className="text-[11px] text-brand-400 hover:text-brand-300">
              {seleccionadas.size === bodegas.length ? 'Ninguna' : 'Todas'}
            </button>
          </div>
          {bodegas.length === 0 ? (
            <p className="text-xs text-slate-500">Cargando…</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-700 p-2">
              {bodegas.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-200">
                  <input type="checkbox" checked={seleccionadas.has(b.id)} onChange={() => toggleBodega(b.id)}
                    className="rounded border-slate-600 bg-slate-700 text-brand-600 focus:ring-brand-500" />
                  {b.nombre}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Naturaleza</span>
          <div className="flex gap-2">
            {(['fisico', 'digital', 'ambos'] as NaturalezaExport[]).map((n) => (
              <button key={n} type="button" onClick={() => setNaturaleza(n)}
                className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${naturaleza === n ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                {n === 'fisico' ? 'Físico' : n === 'digital' ? 'Digital' : 'Ambos'}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
          <input type="checkbox" checked={incluirOtt} onChange={(e) => setIncluirOtt(e.target.checked)}
            className="mt-0.5 rounded border-slate-600 bg-slate-700 text-brand-600 focus:ring-brand-500" />
          <span>
            Incluir material <b>en tránsito e instalado</b> de las OTT abiertas
            <span className="block text-[11px] text-slate-500">
              Hoja aparte con OTT, bodega de origen y lote (Ferretería: "Físico"). Sin insumos.
            </span>
          </span>
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {aviso && <p className="text-xs text-amber-400">{aviso}</p>}

        <button type="button" onClick={() => { generar().catch(() => {}) }} disabled={generando}
          className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
          {generando ? 'Generando…' : 'Generar Excel'}
        </button>
      </div>
    </div>
  )
}
