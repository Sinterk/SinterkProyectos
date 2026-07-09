import { useRef, useState } from 'react'
import { useAttStore } from '../store'
import { FOTO_CATEGORIAS } from '../types'
import { useFileDrop } from '@/ui/useFileDrop'

interface Props {
  recordId: string
  processPhoto: (file: File) => Promise<void>
}

const OPCIONES = [
  ...FOTO_CATEGORIAS,
  { key: 'otro', label: 'Otro' },
] as const

export function SeccionFotos({ recordId, processPhoto }: Props) {
  const { records, removeFoto, updateFoto } = useAttStore()
  const record = records[recordId]
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  if (!record) return null

  async function processFiles(files: File[]) {
    setLoading(true)
    try {
      for (const file of files) await processPhoto(file)
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await processFiles([file])
  }

  const { isDragging, dropProps } = useFileDrop(processFiles)

  function setCategoria(index: number, key: string) {
    updateFoto(recordId, index, { categoria: key, otroLabel: key === 'otro' ? '' : undefined })
  }

  function setOtroLabel(index: number, label: string) {
    updateFoto(recordId, index, { otroLabel: label })
  }

  return (
    <div {...dropProps}
      className={`bg-slate-800 rounded-2xl border p-4 space-y-4 transition-colors ${isDragging ? 'border-brand-500 bg-brand-500/5' : 'border-slate-700'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">5. Registro fotográfico</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="text-xs text-brand-400 hover:text-brand-300 font-semibold disabled:opacity-50">
          {loading ? '⏳ Procesando…' : '+ Agregar foto'}
        </button>
      </div>

      {record.fotos.length === 0 && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className={`w-full h-16 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors disabled:opacity-50 ${isDragging ? 'border-brand-500' : 'border-slate-600 bg-slate-800/50 hover:border-brand-500'}`}>
          <span className="text-slate-500 text-xs">Sin fotos — toca para agregar o arrastra imágenes aquí</span>
        </button>
      )}

      <div className="space-y-3">
        {record.fotos.map((foto, i) => (
          <div key={foto.blobId ?? i} className="flex gap-3 bg-slate-700/50 rounded-xl p-2">
            {/* Miniatura */}
            <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-600 bg-slate-700 shrink-0">
              {foto.previewUrl
                ? <img src={foto.previewUrl} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">⏳</div>
              }
            </div>

            {/* Controles */}
            <div className="flex-1 min-w-0 space-y-2">
              <select
                value={foto.categoria}
                onChange={(e) => setCategoria(i, e.target.value)}
                className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
                {OPCIONES.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>

              {foto.categoria === 'otro' && (
                <input
                  type="text"
                  value={foto.otroLabel ?? ''}
                  onChange={(e) => setOtroLabel(i, e.target.value)}
                  placeholder="Describe el encabezado…"
                  className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none placeholder-slate-500"
                />
              )}
            </div>

            {/* Eliminar */}
            <button
              type="button"
              onClick={() => removeFoto(recordId, i)}
              className="self-start mt-1 w-6 h-6 rounded-full bg-slate-600 text-white text-xs flex items-center justify-center hover:bg-red-600 transition-colors shrink-0">
              ×
            </button>
          </div>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCapture}
      />
    </div>
  )
}
