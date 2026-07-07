import { useEffect, useRef, useState } from 'react'
import { useAttStore } from '../store'
import { isUuid, attRepo } from '../data/attRepo'
import { uploadRecordPhotos } from '../data/photoStorage'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 800

/**
 * Autoguardado online-first para un informe abierto en el Editor: cada cambio
 * de campo actualiza el store local al instante (UI ágil, sin red de por
 * medio); pasado `DEBOUNCE_MS` sin nuevos cambios, sube las fotos pendientes
 * y persiste el informe completo en Supabase vía `attRepo.save`.
 *
 * Si el informe era un borrador local (id nanoid, aún no existe en el
 * servidor), el primer guardado lo inserta y devuelve el uuid canónico; el
 * hook "rekea" el store y avisa por `onIdChange` para que el Editor actualice
 * la URL. En guardados posteriores (id ya es uuid) no hay nada que fusionar:
 * el store local ya es la versión que se acaba de enviar.
 */
export function useAttAutosave(recordId: string, onIdChange?: (newId: string) => void) {
  const record = useAttStore((s) => s.records[recordId])
  const syncedAt = useAttStore((s) => s.syncedAt[recordId])
  const rekey = useAttStore((s) => s.rekey)
  const setFotoStoragePath = useAttStore((s) => s.setFotoStoragePath)
  const setFotoAereaStoragePath = useAttStore((s) => s.setFotoAereaStoragePath)

  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const prevUpdatedAt = useRef<number | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSaving = useRef(false)
  const pendingRetry = useRef(false)

  async function runSave(id: string): Promise<void> {
    if (isSaving.current) { pendingRetry.current = true; return }
    isSaving.current = true
    setStatus('saving')
    setErrorMessage(null)
    let resultId = id
    try {
      const current = useAttStore.getState().records[id]
      if (!current) return // se borró/navegó fuera mientras esperaba el debounce

      const withPhotos = await uploadRecordPhotos(current)
      // Persistir los storagePath recién subidos en el store ANTES de guardar,
      // para que un intento fallido no vuelva a re-subir fotos ya subidas.
      withPhotos.fotos.forEach((f, i) => {
        if (f.storagePath && f.storagePath !== current.fotos[i]?.storagePath) {
          setFotoStoragePath(id, i, f.storagePath)
        }
      })
      if (withPhotos.fotoAerea?.storagePath && withPhotos.fotoAerea.storagePath !== current.fotoAerea?.storagePath) {
        setFotoAereaStoragePath(id, withPhotos.fotoAerea.storagePath)
      }

      const saved = await attRepo.save(withPhotos)

      if (saved.id !== id) {
        rekey(id, saved) // borrador local promovido a uuid del servidor
        resultId = saved.id
        onIdChange?.(saved.id)
      }

      setStatus('saved')
    } catch (err) {
      console.error('[useAttAutosave]', err)
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      isSaving.current = false
      if (pendingRetry.current) {
        pendingRetry.current = false
        if (useAttStore.getState().records[resultId]) runSave(resultId)
      }
    }
  }

  useEffect(() => {
    if (!record) return
    // Montaje: no dispara guardado, solo arma la referencia de comparación.
    if (prevUpdatedAt.current === null) { prevUpdatedAt.current = record.updatedAt; return }
    if (record.updatedAt === prevUpdatedAt.current) return
    // Este updatedAt vino de syncOne/syncList/rekey (servidor), no de una
    // edición del usuario: no hay nada nuevo que guardar.
    if (record.updatedAt === syncedAt) { prevUpdatedAt.current = record.updatedAt; return }
    prevUpdatedAt.current = record.updatedAt

    setStatus('saving')
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => { runSave(record.id) }, DEBOUNCE_MS)

    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.updatedAt, syncedAt])

  function retryNow() {
    if (!record || isSaving.current) return
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    runSave(record.id)
  }

  return { status, errorMessage, retryNow }
}
