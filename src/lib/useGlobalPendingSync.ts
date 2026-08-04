import { useAttStore, hasPendingSync as attPending } from '@/modules/att/store'
import { usePreventivoStore, hasPendingSync as preventivoPending } from '@/modules/preventivos/store'
import { useIncidenciaStore, hasPendingSync as incidenciaPending } from '@/modules/incidencias/store'

export interface GlobalPendingSync {
  total: number
  porArea: { label: string; path: string; count: number }[]
}

// Aviso global (header) de informes sin sincronizar en cualquier área — cada
// módulo ya avisa dentro de su propio Home, esto es para que se note aunque
// el usuario esté en otra pantalla.
export function useGlobalPendingSync(): GlobalPendingSync {
  const att = useAttStore((s) => Object.values(s.records).filter(attPending).length)
  const preventivos = usePreventivoStore((s) => Object.values(s.records).filter(preventivoPending).length)
  const incidencias = useIncidenciaStore((s) => Object.values(s.records).filter(incidenciaPending).length)

  const porArea = [
    { label: 'ATT', path: '/att', count: att },
    { label: 'Preventivos', path: '/preventivos', count: preventivos },
    { label: 'Incidencias', path: '/incidencias', count: incidencias },
  ].filter((a) => a.count > 0)

  return { total: att + preventivos + incidencias, porArea }
}
