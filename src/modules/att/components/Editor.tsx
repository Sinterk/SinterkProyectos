import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAtt } from '../hooks/useAtt'
import { isUuid } from '../data/attRepo'
import { useRestoreAttPhotos } from '../hooks/useRestoreAttPhotos'
import { useResolveAttPhotoUrls } from '../hooks/useResolveAttPhotoUrls'
import { useAttAutosave } from '../hooks/useAttAutosave'
import { useAttStore } from '../store'
import { generarInformeAtt } from '../utils/generarInformeAtt'
import { generarPdfAtt } from '../utils/generarPdfAtt'
import { SeccionTipo } from './SeccionTipo'
import { SeccionDatos } from './SeccionDatos'
import { SeccionDescripcion } from './SeccionDescripcion'
import { SeccionInfra } from './SeccionInfra'
import { SeccionFotos } from './SeccionFotos'
import { LogisticaTab } from '@/ui/LogisticaTab'
import { EstadoProyectoBadge } from '@/ui/EstadoProyectoBadge'
import { EstadoPagoTab } from './EstadoPagoTab'
import { useDocumentTitle } from '@/ui/useDocumentTitle'
import { useAuth } from '@/lib/auth'
import type { AttRecord } from '../types'
import { fechaInicioDe } from '../utils/fechaInicio'

type GenStatus = 'idle' | 'generating' | 'error'

export function Editor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')
  const { record, processPhoto, processFotoAerea } = useAtt(id ?? '')
  const syncOne = useAttStore((s) => s.syncOne)
  const setEstado = useAttStore((s) => s.setEstado)
  useRestoreAttPhotos()
  useResolveAttPhotoUrls()

  const { status: saveStatus, errorMessage: saveError, retryNow } = useAttAutosave(
    id ?? '',
    (newId) => navigate(`/att/${newId}`, { replace: true }),
  )
  const [genStatus, setGenStatus] = useState<GenStatus>('idle')
  const [pdfStatus, setPdfStatus] = useState<GenStatus>('idle')
  // Logística primero (pedido de Andrés). Excepción: un informe recién creado
  // todavía no existe en el servidor y esa pestaña solo diría "guarda el
  // informe primero" — ahí conviene abrir en Info de proyecto.
  const [tab, setTab] = useState<'info' | 'logistica' | 'ep'>(isUuid(id ?? '') ? 'logistica' : 'info')

  // El primer guardado de un borrador local "rekea" su id (nanoid → uuid del
  // servidor) en el store; ese instante deja momentáneamente sin record al id
  // viejo de la URL, en carrera con la navegación hacia el id nuevo. Solo se
  // redirige a Home si el record nunca existió para este id (deep-link roto /
  // recién borrado), no cuando ya existió y desapareció por la promoción.
  const hadRecord = useRef(false)
  useEffect(() => { if (record) hadRecord.current = true }, [record])
  useEffect(() => {
    if (!record && id && !hadRecord.current) navigate('/att', { replace: true })
  }, [record, id, navigate])

  // Trae la versión del servidor al abrir (deep-link / recarga); no pisa
  // ediciones locales más nuevas (ver `mergeFromServer` en el store).
  useEffect(() => { if (id) syncOne(id) }, [id, syncOne])

  // La OTT es el identificador principal de un informe ATT — que se vea en
  // el título de la pestaña del navegador ayuda a distinguir varias pestañas
  // abiertas a la vez. Se actualiza en vivo mientras se tipea.
  useDocumentTitle(record?.ott ? `OTT ${record.ott}` : undefined)

  if (!id || !record) return null

  const title = record.ott ? `OTT ${record.ott}` : 'Nuevo informe ATT'

  async function handleGenerar() {
    if (genStatus === 'generating') return
    setGenStatus('generating')
    try {
      const blob = await generarInformeAtt(record!)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Informe OTT ${record!.ott || 'sin-ott'}.docx`
      a.click()
      URL.revokeObjectURL(url)
      setGenStatus('idle')
    } catch (err) {
      console.error('[ATT DOCX]', err)
      setGenStatus('error')
      setTimeout(() => setGenStatus('idle'), 3000)
    }
  }

  async function handlePdf() {
    if (pdfStatus === 'generating') return
    setPdfStatus('generating')
    try {
      await generarPdfAtt(record!)
      setPdfStatus('idle')
    } catch (err) {
      console.error('[ATT PDF]', err)
      setPdfStatus('error')
      setTimeout(() => setPdfStatus('idle'), 3000)
    }
  }

  return (
    <div className="space-y-4 pb-28">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/att')}
          className="text-slate-400 hover:text-white text-sm">← Volver</button>
        <span className="flex-1 text-sm font-semibold text-white truncate">{title}</span>
        <EstadoProyectoBadge estado={record.estado} onChange={(next) => setEstado(id, next)} />
      </div>

      <BarraDatosProyecto recordId={id} record={record} />

      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('logistica')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tab === 'logistica' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          Logística
        </button>
        <button type="button" onClick={() => setTab('info')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tab === 'info' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          Info de proyecto
        </button>
        {/* RLS de ep_informes/ep_lineas es admin/jp/log únicamente — no tiene sentido mostrarle la pestaña a un técnico. */}
        {!isTecnico && (
          <button type="button" onClick={() => setTab('ep')}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tab === 'ep' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
            Estado de Pago
          </button>
        )}
      </div>

      {tab === 'info' ? (
        isTecnico ? (
          // Rol técnico: en Info de proyecto solo el Registro fotográfico es
          // suyo — la Foto general la busca el JP desde mapa, no la toca el técnico.
          <SeccionFotos recordId={id} processPhoto={processPhoto} />
        ) : (
          <>
            <SeccionTipo recordId={id} />
            <SeccionDatos recordId={id} />
            <SeccionDescripcion recordId={id} processFotoAerea={processFotoAerea} />
            <SeccionInfra recordId={id} />
            <SeccionFotos recordId={id} processPhoto={processPhoto} />
          </>
        )
      ) : tab === 'logistica' ? (
        isUuid(id) ? (
          <LogisticaTab projectId={id} area="ATT"
            ott={record.ott} direccion={record.direccion} fechaInicio={fechaInicioDe(record)} />
        ) : (
          <p className="text-xs text-slate-500 text-center py-8">Guarda el informe primero para gestionar logística.</p>
        )
      ) : isUuid(id) ? (
        <EstadoPagoTab projectId={id} tramos={record.tramos} />
      ) : (
        <p className="text-xs text-slate-500 text-center py-8">Guarda el informe primero para armar el Estado de Pago.</p>
      )}

      {/* Barra inferior fija */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-700 px-4 py-3 flex items-center gap-3 z-40">
        <button type="button" onClick={() => navigate('/att')}
          className="py-2.5 px-4 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition-colors shrink-0">
          ← Volver
        </button>
        <div className="flex-1 flex items-center justify-center">
          {saveStatus === 'saving' && <span className="text-xs text-amber-400 animate-pulse">⏳ Guardando…</span>}
          {saveStatus === 'error' && (
            <button type="button" onClick={retryNow}
              className="text-xs text-red-400 hover:text-red-300 underline"
              title={saveError ?? undefined}>
              ⚠️ Sin guardar — reintentar
            </button>
          )}
          {(saveStatus === 'saved' || saveStatus === 'idle') && (
            <span className="text-xs text-green-500">✅ Guardado</span>
          )}
        </div>
        <button
          type="button"
          onClick={handlePdf}
          disabled={pdfStatus === 'generating'}
          className="py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors shrink-0 disabled:opacity-60">
          {pdfStatus === 'generating' ? '⏳ Comprimiendo…'
            : pdfStatus === 'error'  ? '❌ Error'
            : '🖨 PDF'}
        </button>
        <button
          type="button"
          onClick={handleGenerar}
          disabled={genStatus === 'generating'}
          className="py-2.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors shrink-0 disabled:opacity-60">
          {genStatus === 'generating' ? '⏳ Generando…'
            : genStatus === 'error'  ? '❌ Error'
            : '📄 DOCX'}
        </button>
      </div>
    </div>
  )
}

/**
 * Barra de datos siempre visible arriba de las pestañas: los cuatro datos que
 * Andrés necesita a mano sin importar en qué pestaña esté (OTT, Dirección,
 * Fecha de inicio, Fecha de término).
 *
 * - La OTT y la Dirección se guardan por el autoguardado normal del Editor.
 * - Fecha de inicio: vacía muestra la fecha de creación de la OTT; al
 *   escribir una, esa manda (queda en `fecha_inicio`, ver 0054).
 * - Fecha de término: NO va por el autoguardado — `fecha_cierre` está
 *   excluido del payload de `save()` a propósito, para que un guardado normal
 *   no pueda tocar el cierre de un proyecto. Se escribe con su propia acción
 *   (`setFechaCierre`) al salir del campo. Cerrar el proyecto desde el badge
 *   de estado solo la rellena si está vacía.
 */
function BarraDatosProyecto({ recordId, record }: { recordId: string; record: AttRecord }) {
  const update = useAttStore((s) => s.update)
  const setFechaCierre = useAttStore((s) => s.setFechaCierre)
  const [errorFecha, setErrorFecha] = useState<string | null>(null)

  const fechaInicioMostrada = fechaInicioDe(record)
  const inputCls = 'w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const labelCls = 'block text-[10px] text-slate-400 mb-0.5'

  async function guardarFechaTermino(valor: string) {
    if ((valor || '') === (record.fechaCierre ?? '')) return
    setErrorFecha(null)
    const r = await setFechaCierre(recordId, valor)
    if (!r.ok) setErrorFecha(r.error)
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label>
          <span className={labelCls}>OTT</span>
          <input value={record.ott} onChange={(e) => update(recordId, { ott: e.target.value })}
            placeholder="Ej. 72503609135" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Dirección</span>
          <input value={record.direccion ?? ''} onChange={(e) => update(recordId, { direccion: e.target.value })}
            placeholder="Dirección del proyecto" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Fecha de inicio</span>
          <input type="date" value={fechaInicioMostrada}
            onChange={(e) => update(recordId, { fechaInicio: e.target.value })} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Fecha de término</span>
          <input type="date" value={record.fechaCierre ?? ''}
            onChange={(e) => guardarFechaTermino(e.target.value)} className={inputCls} />
        </label>
      </div>
      {errorFecha && <p className="text-[11px] text-red-400 mt-1">{errorFecha}</p>}
    </div>
  )
}
