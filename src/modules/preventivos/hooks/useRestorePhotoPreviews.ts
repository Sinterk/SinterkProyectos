import { useEffect } from 'react'
import { usePreventivoStore } from '../store'
import { getPhotoBlob } from '@/core/offline/photoStore'
import type { FotoKey } from '../types'

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

/**
 * Al montar, restaura los previewUrl desde IndexedDB para el levantamiento
 * `id` — antes recorría TODO `records` (cualquier levantamiento cacheado
 * por `syncList()` en la lista), mismo problema que `useResolvePhotoUrls`
 * (ver su comentario): abrir un informe hacía trabajo de IndexedDB por las
 * fotos pendientes de TODOS los levantamientos cacheados, no solo el que se
 * estaba mirando.
 * Los blob URLs expiran al cerrar la pestaña; los blobs en IDB persisten.
 */
export function useRestorePhotoPreviews(id: string) {
  const record = usePreventivoStore((s) => s.records[id])
  const { setFotoPlanoPreview, setPuntoFotoPreview } = usePreventivoStore()

  useEffect(() => {
    if (!record) return
    let cancelled = false

    async function restore() {
      if (!record) return
      // Plano y fotos de puntos en paralelo — antes era un `for` secuencial
      // (un `await getPhotoBlob` a la vez), sumando latencia innecesaria con
      // muchas fotos pendientes de subir.
      const tareas: Promise<void>[] = []

      const plano = record.cuadrante.fotoPlano
      if (plano && !plano.previewUrl && plano.blobId) {
        tareas.push(getPhotoBlob(plano.blobId).then((entry) => {
          if (!cancelled && entry) setFotoPlanoPreview(record.id, URL.createObjectURL(entry.blob))
        }))
      }
      for (const punto of record.puntos) {
        for (const key of FOTO_KEYS) {
          const foto = punto[key]
          if (!foto || foto.previewUrl || !foto.blobId) continue
          tareas.push(getPhotoBlob(foto.blobId).then((entry) => {
            if (!cancelled && entry) setPuntoFotoPreview(record.id, punto.id, key, URL.createObjectURL(entry.blob))
          }))
        }
      }
      await Promise.all(tareas)
    }

    restore().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, record])
}
