import { useEffect } from 'react'
import { useAttStore } from '../store'
import { getSignedUrls } from '../data/photoStorage'

/**
 * Espejo online de `useRestoreAttPhotos`: para las fotos que ya viven en Storage
 * (tienen `storagePath` pero aún no `previewUrl`), pide signed URLs en lote y las
 * vuelca al store como `previewUrl`. Las fotos locales (solo `blobId`) las sigue
 * cubriendo `useRestoreAttPhotos` desde IndexedDB; ambos hooks conviven.
 *
 * La dependencia es la firma de los paths pendientes: cuando se resuelven, la
 * firma queda vacía y el efecto no vuelve a correr (no hace loop).
 */
export function useResolveAttPhotoUrls() {
  const { records, setFotoPreview, setFotoAereaPreview } = useAttStore()

  // Paths con storagePath y sin previewUrl aún → lo que falta resolver.
  const pendingPaths: string[] = []
  for (const r of Object.values(records)) {
    if (r.fotoAerea?.storagePath && !r.fotoAerea.previewUrl) pendingPaths.push(r.fotoAerea.storagePath)
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
      const { records: current } = useAttStore.getState()
      for (const r of Object.values(current)) {
        if (r.fotoAerea?.storagePath && !r.fotoAerea.previewUrl) {
          const u = urls.get(r.fotoAerea.storagePath)
          if (u) setFotoAereaPreview(r.id, u)
        }
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
