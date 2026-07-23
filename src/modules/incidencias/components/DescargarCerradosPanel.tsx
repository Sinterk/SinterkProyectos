import { useMemo, useState } from 'react'
import { incidenciaRepo } from '../data/incidenciaRepo'
import { removePhotoObjects } from '../data/photoStorage'
import { buildClosedIncidenciasZip } from '../utils/exportClosedIncidencias'
import type { Incidencia } from '../types'

interface Props {
  /** Incidencias cerradas ya cargadas por Home (con fotos completas). */
  records: Incidencia[]
  /** Se llama tras borrar fotos, para refrescar la lista desde el servidor. */
  onChanged: () => void
}

function todayISO(): string { return new Date().toISOString().slice(0, 10) }
function monthsAgoISO(n: number): string {
  const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10)
}
function sig(records: Incidencia[]): string { return records.map((r) => r.id).sort().join(',') }

export function DescargarCerradosPanel({ records, onChanged }: Props) {
  const [desde, setDesde] = useState(monthsAgoISO(6))
  const [hasta, setHasta] = useState(todayISO())
  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null)
  const [downloadedSig, setDownloadedSig] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [resultMsg, setResultMsg] = useState('')

  const seleccionados = useMemo(
    () => records.filter((r) => (!r.fechaCierre || (r.fechaCierre >= desde && r.fechaCierre <= hasta))),
    [records, desde, hasta],
  )
  const seleccionSig = sig(seleccionados)
  const puedeBorrar = seleccionados.length > 0 && downloadedSig === seleccionSig && !building && !deleting

  async function handleDescargar() {
    if (seleccionados.length === 0) return
    setErrorMsg(''); setResultMsg(''); setBuilding(true); setProgress({ i: 0, total: seleccionados.length })
    try {
      const blob = await buildClosedIncidenciasZip(seleccionados, (i, total) => setProgress({ i, total }))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Incidencias_cerradas_${desde}_a_${hasta}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setDownloadedSig(seleccionSig)
    } catch (err) {
      console.error(err)
      setErrorMsg(err instanceof Error ? err.message : 'Error al generar el ZIP')
    } finally {
      setBuilding(false); setProgress(null)
    }
  }

  async function handleConfirmarBorrado() {
    if (confirmText !== 'BORRAR') return
    setDeleting(true); setErrorMsg(''); setResultMsg('')
    let ok = 0, fail = 0
    for (const record of seleccionados) {
      try {
        const paths = record.fotos.map((f) => f.storagePath)
        await removePhotoObjects(paths)
        await incidenciaRepo.save({ ...record, fotos: [] })
        ok++
      } catch (err) {
        console.error('[DescargarCerradosPanel] error borrando fotos:', record.id, err)
        fail++
      }
    }
    setDeleting(false); setShowConfirm(false); setConfirmText(''); setDownloadedSig(null)
    setResultMsg(`✅ ${ok} incidencia(s) con fotos borradas de Storage.${fail > 0 ? ` ⚠️ ${fail} con error.` : ''}`)
    onChanged()
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-white">📦 Descargar cerradas</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Exporta un ZIP con las fotos de las incidencias cerradas en el rango. Para ahorrar
          espacio en Supabase, luego puedes borrar solo las fotos (la incidencia y sus
          movimientos de material se mantienen intactos).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Desde
          <input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setDownloadedSig(null) }}
            className="bg-slate-900 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-700 focus:border-brand-500 focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Hasta
          <input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setDownloadedSig(null) }}
            className="bg-slate-900 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-700 focus:border-brand-500 focus:outline-none" />
        </label>
        <span className="text-xs text-slate-500 pb-2">{seleccionados.length} incidencia(s) en el rango</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { handleDescargar().catch(console.error) }}
          disabled={building || seleccionados.length === 0}
          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold px-3 py-2 rounded-xl">
          {building ? `⏳ Generando… ${progress ? `${progress.i}/${progress.total}` : ''}` : '📥 Descargar'}
        </button>
        <button type="button" onClick={() => setShowConfirm(true)}
          disabled={!puedeBorrar}
          title={!puedeBorrar ? 'Primero descarga esta misma selección' : undefined}
          className="bg-red-900/60 hover:bg-red-800 disabled:opacity-40 text-red-200 text-sm font-semibold px-3 py-2 rounded-xl">
          🗑️ Descargar y borrar fotos
        </button>
      </div>

      {errorMsg && <p className="text-xs text-red-400">⚠️ {errorMsg}</p>}
      {resultMsg && <p className="text-xs text-green-400">{resultMsg}</p>}

      {showConfirm && (
        <div className="bg-red-950/40 border border-red-700/50 rounded-xl p-3 space-y-2">
          <p className="text-xs text-red-200">
            Esto borra permanentemente las fotos en Supabase Storage de las {seleccionados.length}
            incidencia(s) descargadas (código, materiales y movimientos NO se tocan).
            Escribe <strong>BORRAR</strong> para confirmar.
          </p>
          <div className="flex items-center gap-2">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              placeholder="BORRAR"
              className="bg-slate-900 text-white text-sm rounded-lg px-2 py-1.5 border border-red-700/50 focus:border-red-500 focus:outline-none" />
            <button type="button" onClick={() => { handleConfirmarBorrado().catch(console.error) }}
              disabled={confirmText !== 'BORRAR' || deleting}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg">
              {deleting ? '⏳ Borrando…' : 'Confirmar borrado'}
            </button>
            <button type="button" onClick={() => { setShowConfirm(false); setConfirmText('') }}
              className="text-slate-400 hover:text-white text-xs px-2 py-2">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
