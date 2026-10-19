import { useCallback } from 'react'
import { nanoid } from '@/core/utils/nanoid'
import { usePreventivoStore } from '../store'
import { savePhotoBlob, deletePhotoBlob } from '@/core/offline/photoStore'
import { compressImage } from '@/core/utils/compressImage'
import type { FotoKey } from '../types'
import { resolveRecordId } from '@/core/utils/resolveRecordId'

export function usePreventivo(urlId: string) {
  const store = usePreventivoStore()
  const preventivoId = resolveRecordId(store, urlId)
  const record = store.records[preventivoId]

  const processPhoto = useCallback(
    async (file: File, puntoId: string, key: FotoKey) => {
      if (!record) return

      const compressed = await compressImage(file)
      const previewUrl = URL.createObjectURL(compressed)
      const blobId = nanoid()

      const punto = record.puntos.find((p) => p.id === puntoId)
      const nombrePunto = punto?.nombre?.trim() || `p-${puntoId.slice(0, 6)}`
      const suffix = key === 'fotoLevantamiento' ? 'levantamiento' : key === 'fotoAntes' ? 'antes' : 'despues'
      const fileName = `${nombrePunto}_${suffix}.jpeg`
        .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._-]/g, '-')

      // Borrar blob anterior de IDB si existe
      const prev = punto?.[key]
      if (prev?.blobId) await deletePhotoBlob(prev.blobId).catch(() => {})

      await savePhotoBlob({ id: blobId, blob: compressed, fileName })

      store.setFoto(preventivoId, puntoId, key, {
        previewUrl,
        fileName,
        blobId,
        capturedAt: new Date().toISOString(),
        annotated: false,
      })
    },
    [record, preventivoId, store],
  )

  return { record, processPhoto }
}
