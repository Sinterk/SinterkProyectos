import { useState } from 'react'
import { generarLevantamiento } from '../utils/generarLevantamiento'
import type { Preventivo } from '../types'

export function ExportLevButton({ preventivo }: { preventivo: Preventivo }) {
  const [loading, setLoading] = useState(false)
  const disabled = preventivo.puntos.length === 0

  async function handleClick() {
    if (disabled) return
    setLoading(true)
    try {
      generarLevantamiento(preventivo)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      title={disabled ? 'Agrega puntos antes de exportar' : 'Exportar Excel de levantamiento'}
      className="py-2 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors shrink-0 flex items-center gap-1.5"
    >
      {loading ? <span className="animate-spin">⏳</span> : '📊'}
      <span>Levantamiento</span>
    </button>
  )
}
