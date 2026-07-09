import { useRef, useState, useEffect } from 'react'
import { usePreventivoStore } from '../store'
import { compressImage } from '@/core/utils/compressImage'
import { savePhotoBlob, deletePhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import type { CuadranteInfo } from '../types'
import { useFileDrop } from '@/ui/useFileDrop'

interface Props {
  preventivoId: string
  cuadrante: CuadranteInfo
  onSave?: () => void
}

const inputCls = 'w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:border-brand-500 focus:outline-none placeholder-slate-500'

const RESPONSABLES_POR_ZONA: Record<string, string> = {
  '1': 'Luis Poggi - Gerardo Vargas',
  '2': 'Efraín Salazar - Alfredo Arriagada - Manuel Brito',
  '3': 'Juan Peranchiguay - Fernando Monroy - Cesar Valenzuela',
}

export function CuadranteSection({ preventivoId, cuadrante, onSave }: Props) {
  const { updateCuadrante } = usePreventivoStore()
  const planoInputRef = useRef<HTMLInputElement>(null)
  const [loadingPlano, setLoadingPlano] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  // Cerrar lightbox con ESC
  useEffect(() => {
    if (!lightbox) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightbox(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  function set<K extends keyof CuadranteInfo>(key: K, value: CuadranteInfo[K]) {
    updateCuadrante(preventivoId, { [key]: value })
    onSave?.()
  }

  function handleZonaChange(zona: string) {
    updateCuadrante(preventivoId, { zona, responsable: RESPONSABLES_POR_ZONA[zona] ?? '' })
    onSave?.()
  }

  async function processPlanoFile(file: File) {
    setLoadingPlano(true)
    try {
      const compressed = await compressImage(file)
      const blobId = nanoid()
      const slug = (cuadrante.cuadrante || 'sin-id').replace(/[^a-zA-Z0-9-]/g, '_')
      const fileName = `plano_${slug}.jpeg`
      if (cuadrante.fotoPlano?.blobId) await deletePhotoBlob(cuadrante.fotoPlano.blobId).catch(() => {})
      await savePhotoBlob({ id: blobId, blob: compressed, fileName })
      updateCuadrante(preventivoId, {
        fotoPlano: {
          previewUrl: URL.createObjectURL(compressed),
          fileName,
          blobId,
          capturedAt: new Date().toISOString(),
          annotated: false,
        },
      })
      onSave?.()
    } finally {
      setLoadingPlano(false)
      if (planoInputRef.current) planoInputRef.current.value = ''
    }
  }

  async function handlePlanoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await processPlanoFile(file)
  }

  const { isDragging: isDraggingPlano, dropProps: dropPropsPlano } = useFileDrop(([file]) => { if (file) processPlanoFile(file) })

  async function handleRemovePlano() {
    if (cuadrante.fotoPlano?.blobId) await deletePhotoBlob(cuadrante.fotoPlano.blobId).catch(() => {})
    updateCuadrante(preventivoId, { fotoPlano: undefined })
    onSave?.()
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-brand-400 uppercase tracking-wide">📍 Cuadrante</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Comuna <span className="text-red-400">*</span></label>
          <input type="text" value={cuadrante.comuna}
            onChange={(e) => set('comuna', e.target.value)}
            placeholder="Ej. Providencia" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">N° Cuadrante <span className="text-red-400">*</span></label>
          <input type="text" value={cuadrante.cuadrante}
            onChange={(e) => set('cuadrante', e.target.value)}
            placeholder="Ej. C-042" className={inputCls} />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Grupo</label>
        <select value={cuadrante.grupo ?? ''} onChange={(e) => set('grupo', e.target.value)} className={inputCls}>
          <option value="">Seleccionar…</option>
          <option value="Equifiber">Equifiber</option>
          <option value="Onnet">Onnet</option>
        </select>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-2">📐 Foto del plano de trabajo</label>
        {cuadrante.fotoPlano?.previewUrl ? (
          <>
            <div className="relative rounded-xl overflow-hidden border-2 border-slate-600">
              <img
                src={cuadrante.fotoPlano.previewUrl}
                alt="Plano"
                className="w-full max-h-56 object-contain bg-slate-900 cursor-zoom-in"
                onClick={() => setLightbox(true)}
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-1.5 flex items-center justify-between">
                <span className="text-xs text-white">📐 Plano</span>
                <button type="button" onClick={handleRemovePlano}
                  className="text-red-400 text-xs font-bold hover:text-red-300">✕ Quitar</button>
              </div>
            </div>

            {/* Lightbox del plano */}
            {lightbox && (
              <div
                className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center p-4"
                onClick={() => setLightbox(false)}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(false)}
                  className="absolute top-4 right-4 text-white/60 hover:text-white text-4xl font-light leading-none"
                  aria-label="Cerrar"
                >
                  ×
                </button>
                <div
                  className="flex flex-col items-center gap-3 max-w-full max-h-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    src={cuadrante.fotoPlano.previewUrl}
                    alt="Plano"
                    className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
                  />
                  <span className="text-slate-400 text-sm">📐 Plano de trabajo</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <button type="button"
            onClick={() => planoInputRef.current?.click()}
            disabled={loadingPlano} {...dropPropsPlano}
            className={`w-full h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50 ${isDraggingPlano ? 'border-brand-500 bg-brand-500/10' : 'border-slate-600 bg-slate-800/50 hover:border-brand-500 hover:bg-slate-700/50'}`}>
            {loadingPlano
              ? <span className="animate-spin text-xl">⏳</span>
              : <><span className="text-2xl">📐</span><span className="text-xs text-slate-400">Agregar foto del plano o arrastrar aquí</span></>
            }
          </button>
        )}
        <input ref={planoInputRef} type="file" accept="image/*"
          className="hidden" onChange={handlePlanoCapture} />
      </div>

      <div className="space-y-3 pt-2 border-t border-slate-700">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Fecha</label>
            <input type="date" value={cuadrante.fecha}
              onChange={(e) => set('fecha', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Semana</label>
            <input type="text" value={cuadrante.semana}
              onChange={(e) => set('semana', e.target.value)}
              placeholder="Ej. Semana 24" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Semestre</label>
          <input type="number" min="1" value={cuadrante.semestre ?? ''}
            onChange={(e) => set('semestre', e.target.value)}
            placeholder="Ej. 1" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nombre del cuadrante</label>
          <input type="text" value={cuadrante.nombreCuadrante}
            onChange={(e) => set('nombreCuadrante', e.target.value)}
            placeholder="Ej. Norte Centro Histórico" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Dirección</label>
          <input type="text" value={cuadrante.direccion}
            onChange={(e) => set('direccion', e.target.value)}
            placeholder="Ej. 6a Av. 0-60, zona 1" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Zona</label>
            <select value={cuadrante.zona}
              onChange={(e) => handleZonaChange(e.target.value)} className={inputCls}>
              <option value="">Seleccionar…</option>
              <option value="1">Zona 1</option>
              <option value="2">Zona 2</option>
              <option value="3">Zona 3</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Responsable</label>
            <input type="text" value={cuadrante.responsable}
              onChange={(e) => set('responsable', e.target.value)}
              placeholder="Ej. Luis Poggi - Gerardo Vargas" className={inputCls} />
          </div>
        </div>
      </div>
    </div>
  )
}
