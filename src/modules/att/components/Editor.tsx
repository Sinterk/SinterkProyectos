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

type GenStatus = 'idle' | 'generating' | 'error'

export function Editor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { record, processPhoto, processFotoAerea } = useAtt(id ?? '')
  const syncOne = useAttStore((s) => s.syncOne)
  useRestoreAttPhotos()
  useResolveAttPhotoUrls()

  const { status: saveStatus, errorMessage: saveError, retryNow } = useAttAutosave(
    id ?? '',
    (newId) => navigate(`/att/${newId}`, { replace: true }),
  )
  const [genStatus, setGenStatus] = useState<GenStatus>('idle')
  const [pdfStatus, setPdfStatus] = useState<GenStatus>('idle')
  const [tab, setTab] = useState<'info' | 'logistica'>('info')

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
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('info')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tab === 'info' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          Info de proyecto
        </button>
        <button type="button" onClick={() => setTab('logistica')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tab === 'logistica' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          Logística
        </button>
      </div>

      {tab === 'info' ? (
        <>
          <SeccionTipo recordId={id} />
          <SeccionDatos recordId={id} />
          <SeccionDescripcion recordId={id} processFotoAerea={processFotoAerea} />
          <SeccionInfra recordId={id} />
          <SeccionFotos recordId={id} processPhoto={processPhoto} />
        </>
      ) : isUuid(id) ? (
        <LogisticaTab projectId={id} projectOtt={record.ott || 'Sin OTT'} area="ATT" />
      ) : (
        <p className="text-xs text-slate-500 text-center py-8">Guarda el informe primero para gestionar logística.</p>
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
