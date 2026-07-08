import { useEffect } from 'react'
import { usePreventivoStore } from '../store'
import { getPhotoBlob } from '@/core/offline/photoStore'
import type { FotoKey } from '../types'

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

/**
 * Al montar, restaura los previewUrl desde IndexedDB.
 * Los blob URLs expiran al cerrar la pestaña; los blobs en IDB persisten.
 */
export function useRestorePhotoPreviews() {
  const { records, setFotoPlanoPreview, setPuntoFotoPreview } = usePreventivoStore()

  useEffect(() => {
    let cancelled = false

    async function restore() {
      for (const preventivo of Object.values(records)) {
        // Restaurar plano
        const plano = preventivo.cuadrante.fotoPlano
        if (plano && !plano.previewUrl && plano.blobId) {
          const entry = await getPhotoBlob(plano.blobId)
          if (!cancelled && entry) {
            setFotoPlanoPreview(preventivo.id, URL.createObjectURL(entry.blob))
          }
        }
        // Restaurar fotos de puntos
        for (const punto of preventivo.puntos) {
          for (const key of FOTO_KEYS) {
            const foto = punto[key]
            if (!foto || foto.previewUrl || !foto.blobId) continue
            const entry = await getPhotoBlob(foto.blobId)
            if (!cancelled && entry) {
              setPuntoFotoPreview(preventivo.id, punto.id, key, URL.createObjectURL(entry.blob))
            }
          }
        }
      }
    }

    restore().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
