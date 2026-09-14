import { useEffect, useRef } from 'react'
import { useAttStore, hasPendingSync as attPending } from '@/modules/att/store'
import { usePreventivoStore, hasPendingSync as preventivoPending } from '@/modules/preventivos/store'
import { useIncidenciaStore, hasPendingSync as incidenciaPending } from '@/modules/incidencias/store'

/**
 * Reintenta solo los registros que quedaron sin sincronizar (borrador local,
 * o foto capturada sin subir a Storage) al abrir la app y cada vez que vuelve
 * la conexión — antes dependía de que alguien pasara por el Home de cada
 * módulo y tocara "Sincronizar ahora" a mano.
 *
 * Bug real reportado por un técnico: subió fotos de puntos en Preventivos,
 * cerró el navegador, y al volver no habían llegado al servidor. La subida
 * corre atada al autoguardado mientras la pestaña está abierta — si se
 * cierra a mitad de camino, queda huérfana en el dispositivo para siempre
 * salvo reintento manual. Esto cubre exactamente ese caso sin que nadie
 * tenga que acordarse de nada. No usa Background Sync del service worker
 * (no soportado en Firefox) — corre en la pestaña mientras esté abierta,
 * igual que el autoguardado, pero sin esperar a que el usuario visite Home.
 */
export function useAutoRetryPendingSync() {
  const runningRef = useRef(false)

  useEffect(() => {
    async function retryAll() {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const attIds = Object.values(useAttStore.getState().records).filter(attPending).map((r) => r.id)
        for (const id of attIds) {
          await useAttStore.getState().persistToServer(id).catch((err) => console.warn('[autoRetrySync] ATT', id, err))
        }

        const preventivoIds = Object.values(usePreventivoStore.getState().records).filter(preventivoPending).map((r) => r.id)
        for (const id of preventivoIds) {
          await usePreventivoStore.getState().persistToServer(id).catch((err) => console.warn('[autoRetrySync] Preventivos', id, err))
        }

        const incidenciaIds = Object.values(useIncidenciaStore.getState().records).filter(incidenciaPending).map((r) => r.id)
        for (const id of incidenciaIds) {
          await useIncidenciaStore.getState().persistToServer(id).catch((err) => console.warn('[autoRetrySync] Incidencias', id, err))
        }
      } finally {
        runningRef.current = false
      }
    }

    retryAll().catch(console.error)
    window.addEventListener('online', retryAll)
    return () => window.removeEventListener('online', retryAll)
  }, [])
}
