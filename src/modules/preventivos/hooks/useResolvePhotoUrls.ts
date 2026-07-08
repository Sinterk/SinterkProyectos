import { useEffect } from 'react'
import { usePreventivoStore } from '../store'
import { getSignedUrls } from '../data/photoStorage'
import type { FotoKey } from '../types'

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

/**
 * Espejo online de `useRestorePhotoPreviews`: para las fotos que ya viven en
 * Storage (tienen `storagePath` pero aún no `previewUrl`), pide signed URLs
 * en lote y las vuelca al store como `previewUrl`. Las fotos locales (solo
 * `blobId`) las sigue cubriendo `useRestorePhotoPreviews` desde IndexedDB;
 * ambos hooks conviven.
 */
export function useResolvePhotoUrls() {
  const { records, setFotoPlanoPreview, setPuntoFotoPreview } = usePreventivoStore()

  const pendingPaths: string[] = []
  for (const r of Object.values(records)) {
    if (r.cuadrante.fotoPlano?.storagePath && !r.cuadrante.fotoPlano.previewUrl) {
      pendingPaths.push(r.cuadrante.fotoPlano.storagePath)
    }
    for (const p of r.puntos) {
      for (const key of FOTO_KEYS) {
        const f = p[key]
        if (f?.storagePath && !f.previewUrl) pendingPaths.push(f.storagePath)
      }
    }
  }
  const pendingKey = pendingPaths.slice().sort().join('|')

  useEffect(() => {
    if (pendingPaths.length === 0) return
    let cancelled = false

    async function resolve() {
      const urls = await getSignedUrls([...new Set(pendingPaths)])
      if (cancelled) return
      const { records: current } = usePreventivoStore.getState()
      for (const r of Object.values(current)) {
        if (r.cuadrante.fotoPlano?.storagePath && !r.cuadrante.fotoPlano.previewUrl) {
          const u = urls.get(r.cuadrante.fotoPlano.storagePath)
          if (u) setFotoPlanoPreview(r.id, u)
        }
        for (const p of r.puntos) {
          for (const key of FOTO_KEYS) {
            const f = p[key]
            if (f?.storagePath && !f.previewUrl) {
              const u = urls.get(f.storagePath)
              if (u) setPuntoFotoPreview(r.id, p.id, key, u)
            }
          }
        }
      }
    }

    resolve().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])
}
