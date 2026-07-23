import { useRef, useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIncidenciaStore } from '../store'
import { useIncidencia } from '../hooks/useIncidencia'
import { isUuid } from '../data/incidenciaRepo'
import { LogisticaTab } from '@/ui/LogisticaTab'
import { EstadoProyectoBadge } from '@/ui/EstadoProyectoBadge'
import { ObservacionesSection } from '@/ui/ObservacionesSection'
import { useRestoreIncidenciaPhotos } from '../hooks/useRestoreIncidenciaPhotos'
import { useResolveIncidenciaPhotoUrls } from '../hooks/useResolveIncidenciaPhotoUrls'
import { useIncidenciaAutosave } from '../hooks/useIncidenciaAutosave'
import { SeccionInformacion } from './SeccionInformacion'
import { SeccionFotos } from './SeccionFotos'

type Tab = 'info' | 'materiales' | 'fotos' | 'comentarios'

export function Editor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { record, processPhoto } = useIncidencia(id ?? '')
  const { syncOne, setEstado } = useIncidenciaStore()
  useRestoreIncidenciaPhotos()
  useResolveIncidenciaPhotoUrls()

  const { status: saveStatus, errorMessage: saveError, retryNow } = useIncidenciaAutosave(
    id ?? '',
    (newId) => navigate(`/incidencias/${newId}`, { replace: true }),
  )

  const [tab, setTab] = useState<Tab>('info')

  // Mismo fix del PASO 11 (ATT/Preventivos): solo redirigir si el record
  // NUNCA existió para este id, no cuando ya existió y se promovió (rekey).
  const hadRecord = useRef(false)
  useEffect(() => { if (record) hadRecord.current = true }, [record])
  useEffect(() => {
    if (!record && id && !hadRecord.current) navigate('/incidencias', { replace: true })
  }, [record, id, navigate])

  useEffect(() => { if (id) syncOne(id) }, [id, syncOne])

  if (!record) {
    return <div className="text-slate-400 text-center py-16">Incidencia no encontrada.</div>
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'info', label: 'Información' },
    { key: 'materiales', label: 'Materiales' },
    { key: 'fotos', label: 'Fotos' },
    { key: 'comentarios', label: 'Comentarios' },
  ]

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/incidencias')}
          className="text-slate-400 hover:text-white text-sm">← Volver</button>
        <span className="flex-1 text-sm font-semibold text-white truncate">
          {record.codigo || 'Nueva incidencia'}
        </span>
        <EstadoProyectoBadge estado={record.estado} onChange={(next) => setEstado(record.id, next)} />
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'info' && <SeccionInformacion record={record} />}

      {tab === 'materiales' && (
        isUuid(record.id) ? (
          <LogisticaTab projectId={record.id} area="OyM" incluirComentarios={false} />
        ) : (
          <p className="text-xs text-slate-500 text-center py-8">Guarda la incidencia primero (agrega el código) para gestionar materiales.</p>
        )
      )}

      {tab === 'fotos' && <SeccionFotos recordId={record.id} processPhoto={processPhoto} />}

      {tab === 'comentarios' && (
        isUuid(record.id) ? (
          <ObservacionesSection projectId={record.id} />
        ) : (
          <p className="text-xs text-slate-500 text-center py-8">Guarda la incidencia primero (agrega el código) para comentar.</p>
        )
      )}

      {/* Barra inferior fija — mismo patrón del PASO 25 (Preventivos): un
          botón explícito de guardar, no solo un indicador pasivo. */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-700 px-4 py-3 flex items-center gap-2">
        <button type="button" onClick={() => navigate('/incidencias')}
          className="py-2.5 px-4 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition-colors shrink-0">
          ← Volver
        </button>
        <button type="button" onClick={retryNow} disabled={saveStatus === 'saving'}
          title={saveError ?? undefined}
          className={`py-2 px-3 rounded-xl text-white text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5 disabled:opacity-60 ${
            saveStatus === 'error' ? 'bg-red-700 hover:bg-red-600' : 'bg-slate-700 hover:bg-slate-600'
          }`}>
          {saveStatus === 'saving' ? <span className="animate-spin">⏳</span> : saveStatus === 'error' ? '⚠️' : '💾'}
          <span>Guardar cambios</span>
        </button>
      </div>
    </div>
  )
}
