// Selector de lote con disponibilidad — se activa cuando se conoce la
// ubicación de referencia (bodega de origen para Entrega/Rebajado, o la
// ubicación personal del técnico para Instalado/Devuelto). Sin esa
// referencia (ej. Solicitud, o bodega aún no elegida) cae a un campo de
// texto libre, como antes.

import { useEffect, useState } from 'react'
import { getStock } from '@/lib/inventario/inventarioRepo'
import type { StockRow } from '@/lib/inventario/types'
import { LOTE_FISICO_FERRETERIA } from '@/lib/inventario/esFerreteria'

const LOTE_NUEVO = '__lote_nuevo__'
const LOTE_SIN_DEFINIR = 'SinDefinir'

interface Props {
  materialId: string
  /** Ubicación donde se busca el stock disponible; null = sin referencia (campo libre), salvo `buscarTodasBodegas`. */
  ubicacionId: string | null
  /** Campo de `stock` que representa "disponible" para este tipo de movimiento. */
  naturaleza: 'fisico' | 'digital'
  /** false para Entrada: se listan los lotes existentes como comodidad, pero ninguno queda deshabilitado (agregar no resta stock). */
  checkAvailability: boolean
  value: string
  onChange: (lote: string) => void
  className?: string
  /**
   * Ignora `ubicacionId` y busca el material en TODAS las bodegas — para
   * elegir un lote ya conocido sin importar dónde está (Entrada: el lote
   * real que entrega SAP no depende de a qué bodega física llega la
   * mercadería). Sin esto, sin `ubicacionId` cae al campo libre de siempre.
   */
  buscarTodasBodegas?: boolean
  /**
   * Filtra el desplegable a lotes que de verdad tienen algo en `naturaleza`
   * (y saca los placeholders 'SinDefinir'/'Físico', que no son lotes reales
   * de SAP) — para Entrada, donde el punto es reutilizar un lote digital ya
   * conocido, no repetir "sin lote" con otro nombre.
   */
  soloConDisponible?: boolean
}

export function LoteSelect({
  materialId, ubicacionId, naturaleza, checkAvailability, value, onChange, className,
  buscarTodasBodegas, soloConDisponible,
}: Props) {
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState('')

  const buscar = buscarTodasBodegas ? !!materialId : !!(materialId && ubicacionId)

  useEffect(() => {
    if (!buscar) { setRows(null); return }
    let cancelled = false
    getStock(buscarTodasBodegas ? { materialId } : { materialId, ubicacionId: ubicacionId ?? undefined })
      .then((r) => { if (!cancelled) setRows(r) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [materialId, ubicacionId, buscarTodasBodegas]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!buscar) {
    return (
      <input placeholder="Lote (opcional)" value={value} onChange={(e) => onChange(e.target.value)} className={className} />
    )
  }

  if (creando) {
    return (
      <div className={`${className ?? ''} flex gap-1`}>
        <input autoFocus value={nuevo} onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { onChange(nuevo.trim()); setCreando(false) } }}
          placeholder="Lote nuevo…"
          className="flex-1 min-w-0 bg-slate-700 text-white rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        <button type="button" onClick={() => { onChange(nuevo.trim()); setCreando(false) }}
          className="text-xs text-slate-400 px-1 shrink-0">✓</button>
      </div>
    )
  }

  // Buscando en todas las bodegas, un mismo lote puede repetirse en varias
  // filas (una por bodega) — se junta en una sola opción sumando cantidad,
  // así un código real de SAP aparece una sola vez en el desplegable.
  let opciones = buscarTodasBodegas ? juntarPorLote(rows ?? []) : (rows ?? [])
  if (soloConDisponible) {
    opciones = opciones.filter((r) =>
      r.lote !== LOTE_SIN_DEFINIR && r.lote !== LOTE_FISICO_FERRETERIA
      && (naturaleza === 'fisico' ? r.cantidadFisico : r.cantidadDigital) !== 0)
  }

  return (
    <select value={value}
      onChange={(e) => {
        if (e.target.value === LOTE_NUEVO) {
          setNuevo(value && !opciones.some((r) => r.lote === value) ? value : '')
          setCreando(true)
          return
        }
        onChange(e.target.value)
      }}
      className={className}>
      <option value="">Sin lote específico</option>
      {opciones.map((r) => {
        const disponible = naturaleza === 'fisico' ? r.cantidadFisico : r.cantidadDigital
        const sinStock = checkAvailability && !(disponible > 0)
        return (
          <option key={r.lote} value={r.lote}>
            {r.lote} ({disponible}){sinStock ? ' ⚠ sin stock' : ''}
          </option>
        )
      })}
      {/* Si el usuario ya tenía tipeado un lote que no está en el stock actual (recién creado en otra pestaña), no lo pierdas. */}
      {value && !opciones.some((r) => r.lote === value) && <option value={value}>{value} (nuevo)</option>}
      <option value={LOTE_NUEVO}>+ Lote nuevo…</option>
    </select>
  )
}

function juntarPorLote(rows: StockRow[]): StockRow[] {
  const porLote = new Map<string, StockRow>()
  for (const r of rows) {
    const acc = porLote.get(r.lote)
    if (!acc) { porLote.set(r.lote, { ...r }); continue }
    acc.cantidadFisico += r.cantidadFisico
    acc.cantidadDigital += r.cantidadDigital
  }
  return [...porLote.values()]
}
