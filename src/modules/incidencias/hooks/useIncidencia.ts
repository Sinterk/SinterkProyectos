import { useCallback } from 'react'
import { nanoid } from '@/core/utils/nanoid'
import { useIncidenciaStore } from '../store'
import { savePhotoBlob } from '@/core/offline/photoStore'
import { compressImage } from '@/core/utils/compressImage'

export function useIncidencia(recordId: string) {
  const store = useIncidenciaStore()
  const record = store.records[recordId]

  const processPhoto = useCallback(
    async (file: File) => {
      if (!record) return
      const compressed = await compressImage(file)
      const previewUrl = URL.createObjectURL(compressed)
      const blobId = nanoid()
      const fileName = `foto_${record.fotos.length}_${recordId.slice(0, 6)}.jpeg`
      await savePhotoBlob({ id: blobId, blob: compressed, fileName })
      store.addFoto(recordId, {
        previewUrl, fileName, blobId,
        capturedAt: new Date().toISOString(),
      })
    },
    [record, recordId, store],
  )

  return { record, processPhoto }
}
