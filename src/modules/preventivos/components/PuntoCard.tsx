import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ObservacionesSection } from '@/ui/ObservacionesSection'
import { isUuid } from '../data/preventivoRepo'
import { PhotoCapture } from './PhotoCapture'
import { PuntoMaterialSection } from './PuntoMaterialSection'
import { usePreventivoStore } from '../store'
import type { Punto, FotoKey } from '../types'

interface Props {
  preventivoId: string
  punto: Punto
  index: number
  total: number
  editable?: boolean
  /** Rol técnico: puede agregar/quitar las 3 fotos del punto, pero no tocar nombre/descripción/dirección/hallazgo ni reordenar/eliminar el punto. */
  soloFotos?: boolean
  onSave: () => Promise<void>
  onMove: (from: number, to: number) => void
  onPhotoCapture: (file: File, key: FotoKey) => Promise<void>
}

const HALLAZGOS: string[] = [
  'Altura de cable Cruce de calles "4,5 mts"',
  'Atenuación fuera de norma sin afectar servicio',
  'CTO sin potencia y sin clientes',
  'Mufa en el suelo',
  'Cámara sin tapa',
  'Cámara Abierta / Sin soldar',
  'Mufa o cable colgando en cruce de calle',
  'Mufa en mal estado',
  'Gestión ante quien corresponda por el Estado Postes/ postación dañada',
  'Baja distancia a Red BT/AT',
  'Bajada Lateral sin fleje',
  'CTO con tapa abierta o sin tapa',
  'Falla en estructura o sellos de cámara',
  'Bandeja de Emergencia / Mufa sin Cúpula',
  'Altura Cable Vano sin riesgo',
  'Vano sobrecargado',
  'Rotulado de Mufas, cables, gabinetes, DC',
  'Rotulado de CTO',
  'Entrada sin sello cable / Mufa',
  'Falta cruceta o Cruceta Dañada',
  'Falta Planimetria',
  'CTO en condición insegura o no autorizada',
]

export function PuntoCard({ preventivoId, punto, index, total, editable = true, soloFotos = false, onMove, onPhotoCapture }: Props) {
  const { updatePunto, removePunto, removeFoto } = usePreventivoStore()
  const [expanded, setExpanded] = useState(true)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: punto.id })

  // soloFotos (rol técnico): los campos de texto/estado quedan de solo lectura,
  // pero las fotos siguen editables (siguen gobernadas por `editable`, no por esto).
  const camposEditable = editable && !soloFotos

  const inputCls = `w-full text-sm rounded-lg px-3 py-2 border focus:outline-none placeholder-slate-500
    ${camposEditable
      ? 'bg-slate-700 text-white border-slate-600 focus:border-brand-500'
      : 'bg-slate-800 text-slate-300 border-slate-700 cursor-default'
    }`

  const fotosSubidas = [punto.fotoLevantamiento, punto.fotoAntes, punto.fotoDespues]
    .filter(Boolean).length

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden ${isDragging ? 'opacity-50 shadow-xl z-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Drag handle */}
        {camposEditable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 shrink-0 p-1 touch-none"
            title="Arrastrar para reordenar"
            tabIndex={-1}
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
              <circle cx="3" cy="3"  r="1.5"/><circle cx="9" cy="3"  r="1.5"/>
              <circle cx="3" cy="8"  r="1.5"/><circle cx="9" cy="8"  r="1.5"/>
              <circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/>
            </svg>
          </button>
        )}

        <span className="bg-brand-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">
          {index + 1}
        </span>

        {camposEditable ? (
          <input
            type="text"
            value={punto.nombre}
            onChange={(e) => updatePunto(preventivoId, punto.id, { nombre: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            placeholder="Nombre del punto (ej. P1)*"
            className="flex-1 bg-transparent text-sm font-medium text-white placeholder-slate-500 focus:outline-none border-b border-transparent focus:border-brand-500 py-0.5"
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-white truncate">
            {punto.nombre || `Punto ${index + 1}`}
          </span>
        )}

        {fotosSubidas > 0 && (
          <span className="text-[10px] text-slate-500 shrink-0">📷 {fotosSubidas}/3</span>
        )}

        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
          punto.resuelto ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'
        }`}>
          {punto.resuelto ? '🔒 Cerrado' : '🔓 Abierto'}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {/* Mover al inicio / al final — solo visible con 3+ puntos */}
          {camposEditable && total >= 3 && (
            <>
              <button
                type="button"
                onClick={() => onMove(index, 0)}
                disabled={index === 0}
                className="text-slate-600 hover:text-brand-400 disabled:opacity-20 text-sm p-1 leading-none"
                title="Mover al inicio"
              >
                ⤒
              </button>
              <button
                type="button"
                onClick={() => onMove(index, total - 1)}
                disabled={index === total - 1}
                className="text-slate-600 hover:text-brand-400 disabled:opacity-20 text-sm p-1 leading-none"
                title="Mover al final"
              >
                ⤓
              </button>
            </>
          )}
          {camposEditable && (
            <button
              type="button"
              onClick={() => removePunto(preventivoId, punto.id)}
              className="text-slate-600 hover:text-red-400 text-base p-1 leading-none"
              title="Eliminar punto"
            >
              ×
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-slate-400 text-xs p-1"
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-700 pt-3">

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Descripción <span className="text-red-400">*</span>
            </label>
            <textarea
              value={punto.descripcion}
              onChange={(e) => camposEditable && updatePunto(preventivoId, punto.id, { descripcion: e.target.value })}
              readOnly={!camposEditable}
              rows={2}
              placeholder="Describe el trabajo realizado…"
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Dirección / Ubicación <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={punto.direccion}
              onChange={(e) => camposEditable && updatePunto(preventivoId, punto.id, { direccion: e.target.value })}
              readOnly={!camposEditable}
              placeholder="Ej. 5a Av. 12-34, zona 1"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Corrección</label>
            <input
              type="text"
              value={punto.correccion ?? ''}
              onChange={(e) => camposEditable && updatePunto(preventivoId, punto.id, { correccion: e.target.value })}
              readOnly={!camposEditable}
              placeholder="Corrección aplicada (opcional)"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Tipo de hallazgo</label>
            <select
              value={punto.hallazgo ?? ''}
              onChange={(e) => camposEditable && updatePunto(preventivoId, punto.id, { hallazgo: e.target.value })}
              disabled={!camposEditable}
              className={inputCls}
            >
              <option value="">Sin hallazgo</option>
              {HALLAZGOS.map((h, i) => (
                <option key={h} value={h}>{i + 1}. {h}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={!!punto.resuelto}
              disabled={!camposEditable}
              onChange={(e) => camposEditable && updatePunto(preventivoId, punto.id, { resuelto: e.target.checked })}
              className="w-4 h-4 accent-brand-500 disabled:opacity-50"
            />
            Punto cerrado (marca manualmente cuando quede resuelto)
          </label>

          <div>
            <label className="block text-xs text-slate-400 mb-2">Fotografías</label>
            <div className="grid grid-cols-3 gap-2">
              {(['fotoLevantamiento', 'fotoAntes', 'fotoDespues'] as FotoKey[]).map((key) => (
                <PhotoCapture
                  key={key}
                  fotoKey={key}
                  label={key === 'fotoLevantamiento' ? 'Levantamiento' : key === 'fotoAntes' ? 'Antes' : 'Después'}
                  entry={punto[key]}
                  onCapture={onPhotoCapture}
                  onRemove={(k) => editable && removeFoto(preventivoId, punto.id, k)}
                />
              ))}
            </div>
          </div>

          {/* Material/comentarios requieren que el punto exista de verdad en el
              servidor (id real, no borrador local) — mismo guard que Incidencias. */}
          {isUuid(preventivoId) ? (
            <>
              <div className="border-t border-slate-700 pt-3">
                <PuntoMaterialSection projectId={preventivoId} puntoId={punto.id} />
              </div>
              <div className="border-t border-slate-700 pt-3">
                <ObservacionesSection projectId={preventivoId} puntoId={punto.id} titulo="Comentarios del punto" compact />
              </div>
            </>
          ) : (
            <p className="text-[11px] text-slate-500 border-t border-slate-700 pt-3">
              Guarda el cuadrante primero para poder anotar material y comentarios en este punto.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
