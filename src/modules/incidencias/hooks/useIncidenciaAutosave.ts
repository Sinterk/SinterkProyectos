import { useEffect, useRef, useState } from 'react'
import { useIncidenciaStore } from '../store'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 800

/**
 * Autoguardado online-first para una incidencia abierta en el Editor —
 * mismo patrón que useAttAutosave/usePreventivoAutosave.
 */
export function useIncidenciaAutosave(recordId: string, onIdChange?: (newId: string) => void) {
  const record = useIncidenciaStore((s) => s.records[recordId])
  const syncedAt = useIncidenciaStore((s) => s.syncedAt[recordId])

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
      if (!useIncidenciaStore.getState().records[id]) return
      const saved = await useIncidenciaStore.getState().persistToServer(id)
      if (saved.id !== id) {
        resultId = saved.id
        onIdChange?.(saved.id)
      }
      setStatus('saved')
    } catch (err) {
      console.error('[useIncidenciaAutosave]', err)
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      isSaving.current = false
      if (pendingRetry.current) {
        pendingRetry.current = false
        if (useIncidenciaStore.getState().records[resultId]) runSave(resultId)
      }
    }
  }

  useEffect(() => {
    if (!record) return
    if (prevUpdatedAt.current === null) { prevUpdatedAt.current = record.updatedAt; return }
    if (record.updatedAt === prevUpdatedAt.current) return
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
