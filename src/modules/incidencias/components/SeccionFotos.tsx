import { useRef, useState } from 'react'
import { useIncidenciaStore } from '../store'
import { useFileDrop } from '@/ui/useFileDrop'

interface Props {
  recordId: string
  processPhoto: (file: File) => Promise<void>
}

/** Galería simple, sin categorías (a diferencia de ATT) — Incidencias solo necesita compartir fotos sueltas. */
export function SeccionFotos({ recordId, processPhoto }: Props) {
  const { records, removeFoto } = useIncidenciaStore()
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

  return (
    <div {...dropProps}
      className={`bg-slate-800 rounded-2xl border p-4 space-y-4 transition-colors ${isDragging ? 'border-brand-500 bg-brand-500/5' : 'border-slate-700'}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Fotos</h2>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={loading}
          className="text-xs text-brand-400 hover:text-brand-300 font-semibold disabled:opacity-50">
          {loading ? '⏳ Procesando…' : '+ Agregar foto'}
        </button>
      </div>

      {record.fotos.length === 0 && (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={loading}
          className={`w-full h-16 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors disabled:opacity-50 ${isDragging ? 'border-brand-500' : 'border-slate-600 bg-slate-800/50 hover:border-brand-500'}`}>
          <span className="text-slate-500 text-xs">Sin fotos — toca para agregar o arrastra imágenes aquí</span>
        </button>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {record.fotos.map((foto, i) => (
          <div key={foto.blobId ?? i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-600 bg-slate-700 group">
            {foto.previewUrl
              ? <img src={foto.previewUrl} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">⏳</div>
            }
            <button type="button" onClick={() => removeFoto(recordId, i)}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white text-xs flex items-center justify-center hover:bg-red-600 transition-colors">
              ×
            </button>
          </div>
        ))}
      </div>

      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture} />
    </div>
  )
}
