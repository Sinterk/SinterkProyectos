import { useState } from 'react'
import JSZip from 'jszip'
import { getPhotoBlob } from '@/core/offline/photoStore'
import type { Preventivo, FotoKey } from '../types'

interface Props { preventivo: Preventivo }

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

// ── Construir el ZIP ──────────────────────────────────────────────────────────
async function buildZip(preventivo: Preventivo): Promise<{ blob: Blob; fileName: string }> {
  const zip = new JSZip()
  const f = zip.folder('fotos')!
  const plano = preventivo.cuadrante.fotoPlano

  if (plano?.blobId) {
    const e = await getPhotoBlob(plano.blobId)
    if (e) f.file(plano.fileName, e.blob)
  }
  for (const p of preventivo.puntos) {
    for (const k of FOTO_KEYS) {
      const foto = p[k]
      if (!foto?.blobId) continue
      const e = await getPhotoBlob(foto.blobId)
      if (e) f.file(foto.fileName, e.blob)
    }
  }

  zip.file('telecom_v1.json', JSON.stringify({
    version: 1, app: 'TelecomCatalog', exportedAt: new Date().toISOString(),
    levantamiento: {
      id: preventivo.id, createdAt: preventivo.createdAt, updatedAt: preventivo.updatedAt,
      cuadrante: {
        ...preventivo.cuadrante,
        semestre: preventivo.cuadrante.semestre,
        fotoPlano: plano ? { fileName: plano.fileName, capturedAt: plano.capturedAt } : null,
      },
      puntos: preventivo.puntos.map((p) => ({
        id: p.id, nombre: p.nombre, descripcion: p.descripcion,
        direccion: p.direccion, correccion: p.correccion,
        hallazgo: p.hallazgo, resuelto: p.resuelto,
        fotos: {
          levantamiento: p.fotoLevantamiento ? { fileName: p.fotoLevantamiento.fileName, capturedAt: p.fotoLevantamiento.capturedAt } : null,
          antes: p.fotoAntes ? { fileName: p.fotoAntes.fileName, capturedAt: p.fotoAntes.capturedAt } : null,
          despues: p.fotoDespues ? { fileName: p.fotoDespues.fileName, capturedAt: p.fotoDespues.capturedAt } : null,
        },
      })),
    },
  }, null, 2))

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const slug = (s?: string) => (s || 'x').replace(/[^a-z0-9-]/gi, '_')
  const fileName = `telecom_${slug(preventivo.cuadrante.cuadrante)}_${slug(preventivo.cuadrante.comuna)}_${new Date().toISOString().slice(0, 10)}.zip`
  return { blob, fileName }
}

// ── Componente ────────────────────────────────────────────────────────────────
// Antes tenía un botón "Compartir ZIP" (Web Share API) y un panel de
// diagnóstico ("🧪 texto"/"🧪 archivo txt") para depurar por qué compartir
// fallaba en Chrome (nunca llegó a funcionar de forma confiable). Con todo
// online ya no tiene sentido: se descarga el ZIP nada más.
export function ExportZipButton({ preventivo }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  async function handleClick() {
    if (state === 'loading') return
    setState('loading')
    try {
      const { blob, fileName } = await buildZip(preventivo)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileName; a.click()
      URL.revokeObjectURL(url)
      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err) {
      console.error('Error al guardar ZIP:', err)
      setState('idle')
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={state === 'loading'}
      className="py-2 px-3 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5">
      {state === 'loading' ? <span className="animate-spin">⏳</span> : state === 'done' ? '✅' : '📦'}
      <span>Guardar ZIP</span>
    </button>
  )
}
