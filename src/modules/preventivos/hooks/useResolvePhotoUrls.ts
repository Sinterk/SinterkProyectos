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
 *
 * Acotado al levantamiento `id` — antes recorría TODO `records` (cualquier
 * levantamiento que hubiera quedado cacheado por `syncList()` en la lista,
 * con sus puntos y rutas de foto completas). Bug real reportado por Andrés
 * ("el sitio está lento, en particular con los preventivos"): abrir UN
 * informe disparaba signed URLs para las fotos de TODOS los levantamientos
 * cacheados, no solo el que se estaba mirando — con ~20 activos y hasta 68
 * puntos cada uno, eso son potencialmente miles de fotos ajenas al informe
 * abierto.
 */
export function useResolvePhotoUrls(id: string) {
  const record = usePreventivoStore((s) => s.records[id])
  const { setFotoPlanoPreview, setPuntoFotoPreview } = usePreventivoStore()

  const pendingPaths: string[] = []
  if (record) {
    if (record.cuadrante.fotoPlano?.storagePath && !record.cuadrante.fotoPlano.previewUrl) {
      pendingPaths.push(record.cuadrante.fotoPlano.storagePath)
    }
    for (const p of record.puntos) {
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
      const r = usePreventivoStore.getState().records[id]
      if (!r) return
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

    resolve().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pendingKey])
}
