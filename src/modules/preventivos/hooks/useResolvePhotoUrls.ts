import { useEffect } from 'react'
import { usePreventivoStore } from '../store'
import { getSignedUrls, getSignedUrlsThumb, isSignedUrlFresh } from '../data/photoStorage'
import type { FotoEntry, FotoKey } from '../types'

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

/**
 * Espejo online de `useRestorePhotoPreviews`: para las fotos que ya viven en
 * Storage (tienen `storagePath`), pide signed URLs y las vuelca al store.
 * Dos URLs por foto, resueltas en paralelo:
 * - `previewUrl` (resolución completa, en lote vía `createSignedUrls`) —
 *   la sigue usando el lightbox y cualquier export/informe.
 * - `thumbUrl` (miniatura 200×200 transformada, una signed URL por foto —
 *   `createSignedUrls` en lote NO soporta `transform`, solo el endpoint de
 *   una foto a la vez) — la usan las miniaturas/grillas. Pedido de Andrés
 *   ("¿se puede hacer que la carga de cuadrantes con muchas fotos sea un
 *   poco más rápida?"): una foto de ~380KB baja a ~9KB con esta
 *   transformación, verificado contra el bucket real.
 *
 * Las fotos locales (solo `blobId`) las sigue cubriendo
 * `useRestorePhotoPreviews` desde IndexedDB — no necesitan miniatura
 * aparte, ya son livianas y están en el dispositivo.
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
  const { setFotoPlanoPreview, setPuntoFotoPreview, setFotoPlanoThumb, setPuntoFotoThumb } = usePreventivoStore()

  const pendingFull: string[] = []
  const pendingThumb: string[] = []
  function track(f: FotoEntry | undefined) {
    if (!f?.storagePath) return
    if (!f.previewUrl || !isSignedUrlFresh(f.previewUrlAt)) pendingFull.push(f.storagePath)
    if (!f.thumbUrl || !isSignedUrlFresh(f.thumbUrlAt)) pendingThumb.push(f.storagePath)
  }
  if (record) {
    track(record.cuadrante.fotoPlano)
    for (const p of record.puntos) for (const key of FOTO_KEYS) track(p[key])
  }
  const pendingKey = `${pendingFull.slice().sort().join('|')}::${pendingThumb.slice().sort().join('|')}`

  useEffect(() => {
    if (pendingFull.length === 0 && pendingThumb.length === 0) return
    let cancelled = false

    async function resolve() {
      const [fullUrls, thumbUrls] = await Promise.all([
        pendingFull.length > 0 ? getSignedUrls([...new Set(pendingFull)]) : new Map<string, string>(),
        pendingThumb.length > 0 ? getSignedUrlsThumb([...new Set(pendingThumb)]) : new Map<string, string>(),
      ])
      if (cancelled) return
      const r = usePreventivoStore.getState().records[id]
      if (!r) return

      function apply(f: FotoEntry | undefined, setPreview: (u: string) => void, setThumb: (u: string) => void) {
        if (!f?.storagePath) return
        if (!f.previewUrl || !isSignedUrlFresh(f.previewUrlAt)) { const u = fullUrls.get(f.storagePath); if (u) setPreview(u) }
        if (!f.thumbUrl || !isSignedUrlFresh(f.thumbUrlAt)) { const u = thumbUrls.get(f.storagePath); if (u) setThumb(u) }
      }

      apply(r.cuadrante.fotoPlano, (u) => setFotoPlanoPreview(r.id, u), (u) => setFotoPlanoThumb(r.id, u))
      for (const p of r.puntos) {
        for (const key of FOTO_KEYS) {
          apply(p[key], (u) => setPuntoFotoPreview(r.id, p.id, key, u), (u) => setPuntoFotoThumb(r.id, p.id, key, u))
        }
      }
    }

    resolve().catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pendingKey])
}
