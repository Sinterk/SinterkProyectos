import { useEffect } from 'react'
import { useIncidenciaStore } from '../store'
import { getSignedUrls } from '../data/photoStorage'

/**
 * Espejo online de useRestoreIncidenciaPhotos: para las fotos que ya viven
 * en Storage (tienen storagePath pero aún no previewUrl), pide signed URLs
 * en lote y las vuelca al store como previewUrl.
 */
export function useResolveIncidenciaPhotoUrls() {
  const { records, setFotoPreview } = useIncidenciaStore()

  const pendingPaths: string[] = []
  for (const r of Object.values(records)) {
    for (const f of r.fotos) {
      if (f.storagePath && !f.previewUrl) pendingPaths.push(f.storagePath)
    }
  }
  const pendingKey = pendingPaths.slice().sort().join('|')

  useEffect(() => {
    if (pendingPaths.length === 0) return
    let cancelled = false

    async function resolve() {
      const urls = await getSignedUrls([...new Set(pendingPaths)])
      if (cancelled) return
      const { records: current } = useIncidenciaStore.getState()
      for (const r of Object.values(current)) {
        r.fotos.forEach((f, i) => {
          if (f.storagePath && !f.previewUrl) {
            const u = urls.get(f.storagePath)
            if (u) setFotoPreview(r.id, i, u)
          }
        })
      }
    }

    resolve().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])
}
