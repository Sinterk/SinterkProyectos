import { useState } from 'react'
import { generarInformeEntel } from '../utils/generarInformeEntel'
import { fotoEstadoDe } from '../utils/fotoEstado'
import type { FotoKey, Preventivo } from '../types'

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

/**
 * Bug real reportado por Andrés: "se me descargó [un informe] sin fotos, al
 * esperar y se cargaron las fotos, se descargó como corresponde". Causa:
 * `generarInformeEntel` (`prepareImage`) omite en silencio cualquier foto
 * sin `previewUrl` todavía resuelto — si se toca "Informe" antes de que
 * `useResolvePhotoUrls`/`useRestorePhotoPreviews` terminen (foto recién
 * subida, o el informe recién abierto), el archivo sale incompleto sin
 * ningún aviso. `fotoEstadoDe(f) === 'descargando'` es exactamente esa
 * espera (`f` existe pero `previewUrl` aún no) — "subiendo" no cuenta: ahí
 * ya hay un `previewUrl` local usable, solo falta terminar de subirlo.
 */
function hayFotosSinCargar(p: Preventivo): boolean {
  if (fotoEstadoDe(p.cuadrante.fotoPlano) === 'descargando') return true
  return p.puntos.some((pt) => FOTO_KEYS.some((k) => fotoEstadoDe(pt[k]) === 'descargando'))
}

export function ExportInformeButton({ preventivo }: { preventivo: Preventivo }) {
  const [loading, setLoading] = useState(false)
  const sinPuntos = preventivo.puntos.length === 0
  const cargandoFotos = !sinPuntos && hayFotosSinCargar(preventivo)
  const disabled = sinPuntos || cargandoFotos

  async function handleClick() {
    if (disabled || loading) return
    setLoading(true)
    try {
      await generarInformeEntel(preventivo)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      title={sinPuntos ? 'Agrega puntos antes de exportar' : cargandoFotos ? 'Esperando a que terminen de cargar las fotos…' : 'Exportar Informe Entel'}
      className="py-2 px-3 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5"
    >
      {loading ? <span className="animate-spin inline-block">⏳</span> : cargandoFotos ? <span className="animate-spin inline-block">⏳</span> : '📋'}
      <span>{cargandoFotos && !loading ? 'Cargando fotos…' : 'Informe'}</span>
    </button>
  )
}
