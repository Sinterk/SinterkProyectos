import { useState } from 'react'
import { generarInformeEntel } from '../utils/generarInformeEntel'
import type { Preventivo } from '../types'

export function ExportInformeButton({ preventivo }: { preventivo: Preventivo }) {
  const [loading, setLoading] = useState(false)
  const disabled = preventivo.puntos.length === 0

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
      title={disabled ? 'Agrega puntos antes de exportar' : 'Exportar Informe Entel'}
      className="py-2 px-3 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5"
    >
      {loading ? <span className="animate-spin inline-block">⏳</span> : '📋'}
      <span>Informe</span>
    </button>
  )
}
