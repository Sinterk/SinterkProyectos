// Selector de lote con disponibilidad — se activa cuando se conoce la
// ubicación de referencia (bodega de origen para Entrega/Rebajado, o la
// ubicación personal del técnico para Instalado/Devuelto). Sin esa
// referencia (ej. Solicitud, o bodega aún no elegida) cae a un campo de
// texto libre, como antes.

import { useEffect, useState } from 'react'
import { getStock } from '@/lib/inventario/inventarioRepo'
import type { StockRow } from '@/lib/inventario/types'

interface Props {
  materialId: string
  /** Ubicación donde se busca el stock disponible; null = sin referencia (campo libre). */
  ubicacionId: string | null
  /** Campo de `stock` que representa "disponible" para este tipo de movimiento. */
  naturaleza: 'fisico' | 'digital'
  /** false para Entrada: se listan los lotes existentes como comodidad, pero ninguno queda deshabilitado (agregar no resta stock). */
  checkAvailability: boolean
  value: string
  onChange: (lote: string) => void
  className?: string
}

export function LoteSelect({ materialId, ubicacionId, naturaleza, checkAvailability, value, onChange, className }: Props) {
  const [rows, setRows] = useState<StockRow[] | null>(null)

  useEffect(() => {
    if (!materialId || !ubicacionId) { setRows(null); return }
    let cancelled = false
    getStock({ materialId, ubicacionId })
      .then((r) => { if (!cancelled) setRows(r) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [materialId, ubicacionId])

  if (!materialId || !ubicacionId) {
    return (
      <input placeholder="Lote (opcional)" value={value} onChange={(e) => onChange(e.target.value)} className={className} />
    )
  }

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Sin lote específico</option>
      {(rows ?? []).map((r) => {
        const disponible = naturaleza === 'fisico' ? r.cantidadFisico : r.cantidadDigital
        // Periodo transitivo (stock físico real vs. lo que ya quedó cargado
        // en el sistema): no bloquear la salida por falta de stock — solo
        // avisar. El backend ya permite quedar en negativo (0008_stock_alertas.sql).
        const sinStock = checkAvailability && !(disponible > 0)
        return (
          <option key={r.lote} value={r.lote}>
            {r.lote} ({disponible}){sinStock ? ' ⚠ sin stock' : ''}
          </option>
        )
      })}
      {/* Si el usuario ya tenía tipeado un lote que no está en el stock actual (recién creado en otra pestaña), no lo pierdas. */}
      {value && !(rows ?? []).some((r) => r.lote === value) && <option value={value}>{value} (nuevo)</option>}
    </select>
  )
}
