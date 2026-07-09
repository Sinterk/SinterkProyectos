import { useRef, useState, useEffect } from 'react'
import type { FotoEntry, FotoKey } from '../types'
import { useFileDrop } from '@/ui/useFileDrop'

interface Props {
  label: string
  fotoKey: FotoKey
  entry?: FotoEntry
  editable?: boolean
  onCapture: (file: File, key: FotoKey) => Promise<void>
  onRemove: (key: FotoKey) => void
}

const LABEL_MAP: Record<FotoKey, { emoji: string; color: string }> = {
  fotoLevantamiento: { emoji: '📋', color: 'border-blue-400' },
  fotoAntes:         { emoji: '🔴', color: 'border-orange-400' },
  fotoDespues:       { emoji: '🟢', color: 'border-green-400' },
}

export function PhotoCapture({ label, fotoKey, entry, editable = true, onCapture, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [lightbox, setLightbox] = useState(false)

  const { emoji, color } = LABEL_MAP[fotoKey]

  // Cerrar lightbox con ESC
  useEffect(() => {
    if (!lightbox) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightbox(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  async function processFile(file: File) {
    setLoading(true)
    try {
      await onCapture(file, fotoKey)
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
  }

  const { isDragging, dropProps } = useFileDrop(([file]) => { if (file) processFile(file) })

  if (entry?.previewUrl) {
    return (
      <>
        <div className={`relative rounded-xl overflow-hidden border-2 ${color} bg-slate-800`}>
          <img
            src={entry.previewUrl}
            alt={label}
            className="w-full h-36 object-cover cursor-zoom-in"
            onClick={() => setLightbox(true)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 flex items-center justify-between">
            <span className="text-xs text-white truncate">{emoji} {label}</span>
            {editable && (
              <button type="button" onClick={() => onRemove(fotoKey)}
                className="text-red-400 text-xs font-bold ml-2 hover:text-red-300">✕</button>
            )}
          </div>
        </div>

        {/* Lightbox */}
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
            <div className="flex flex-col items-center gap-3 max-w-full max-h-full"
              onClick={(e) => e.stopPropagation()}>
              <img
                src={entry.previewUrl}
                alt={label}
                className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
              />
              <span className="text-slate-400 text-sm">{emoji} {label}</span>
            </div>
          </div>
        )}
      </>
    )
  }

  if (!editable) {
    return (
      <div className={`w-full h-36 rounded-xl border-2 border-dashed ${color} bg-slate-800/50 flex flex-col items-center justify-center gap-1`}>
        <span className="text-3xl opacity-30">{emoji}</span>
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-[10px] text-slate-600">Sin foto</span>
      </div>
    )
  }

  return (
    <button type="button" onClick={() => inputRef.current?.click()} disabled={loading} {...dropProps}
      className={`w-full h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50 ${isDragging ? 'border-brand-500 bg-brand-500/10' : `${color} bg-slate-800/50 hover:bg-slate-700/50`}`}>
      {loading
        ? <span className="text-2xl animate-spin">⏳</span>
        : <>
            <span className="text-3xl">{emoji}</span>
            <span className="text-xs text-slate-300">{label}</span>
            <span className="text-[10px] text-slate-500">Toca para capturar o arrastra una foto</span>
          </>
      }
      <input ref={inputRef} type="file" accept="image/*"
        className="hidden" onChange={handleChange} />
    </button>
  )
}
