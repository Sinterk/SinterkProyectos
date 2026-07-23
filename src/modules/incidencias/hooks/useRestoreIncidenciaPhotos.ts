import { useEffect } from 'react'
import { useIncidenciaStore } from '../store'
import { getPhotoBlob } from '@/core/offline/photoStore'

/**
 * Al montar, restaura los previewUrl desde IndexedDB (blobs capturados en
 * este dispositivo). Los blob URLs expiran al cerrar la pestaña; los blobs
 * en IDB persisten.
 */
export function useRestoreIncidenciaPhotos() {
  const { records, setFotoPreview } = useIncidenciaStore()

  useEffect(() => {
    let cancelled = false

    async function restore() {
      for (const record of Object.values(records)) {
        for (let i = 0; i < record.fotos.length; i++) {
          const foto = record.fotos[i]
          if (foto.previewUrl || !foto.blobId) continue
          const entry = await getPhotoBlob(foto.blobId)
          if (!cancelled && entry) {
            setFotoPreview(record.id, i, URL.createObjectURL(entry.blob))
          }
        }
      }
    }

    restore().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
