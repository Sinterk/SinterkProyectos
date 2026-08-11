// Lista de lo ya registrado, bajo el formulario de Registro (Asignaciones y
// Entrada). Pedido de Andrés (11-08-2026): poder volver sobre una tanda ya
// guardada y completarle el lote, porque sin SAP el lote real muchas veces se
// sabe solo después, cuando Entel actualiza su stock.
//
// Las tandas no existen como tabla — se arman agrupando `movimientos` por
// (día, destinatario, documento). Ver `listRegistros` en inventarioRepo.

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { listRegistros, corregirMovimiento, anularMovimiento } from '@/lib/inventario/inventarioRepo'
import type { RegistroAgrupado } from '@/lib/inventario/inventarioRepo'
import type { Movimiento } from '@/lib/inventario/types'

const LOTE_SIN_DEFINIR = 'SinDefinir'

const TIPO_LABELS: Record<string, string> = {
  entrada: 'Entrada', salida: 'Entrega', traslado: 'Devolución', ajuste: 'Conteo',
}

interface Props {
  modo: 'asignaciones' | 'entrada'
  /** Sube cada vez que se registra algo nuevo arriba, para recargar la lista. */
  refreshKey: number
}

export function ListaRegistros({ modo, refreshKey }: Props) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeEditar = rol === 'admin' || rol === 'jp' || rol === 'log'
  const [registros, setRegistros] = useState<RegistroAgrupado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try {
      setRegistros(await listRegistros(modo))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [modo, refreshKey])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-400">
          {modo === 'asignaciones' ? 'Asignaciones registradas' : 'Entradas registradas'}
        </h2>
        <button type="button" onClick={reload} className="text-[10px] text-slate-500 hover:text-brand-400">
          ↻ Actualizar
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {registros === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : registros.length === 0 ? (
        <p className="text-xs text-slate-500">
          {modo === 'asignaciones' ? 'Sin asignaciones registradas.' : 'Sin entradas registradas.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {registros.map((r) => (
            <RegistroCard key={r.key} registro={r} modo={modo} puedeEditar={puedeEditar}
              abierto={abierto === r.key}
              onToggle={() => setAbierto((k) => (k === r.key ? null : r.key))}
              onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

function RegistroCard({ registro, modo, puedeEditar, abierto, onToggle, onChanged }: {
  registro: RegistroAgrupado
  modo: 'asignaciones' | 'entrada'
  puedeEditar: boolean
  abierto: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const destinatario = modo === 'asignaciones'
    ? (registro.tecnicoNombre ?? 'Sin técnico')
    : (registro.bodegaNombre ?? 'Sin bodega')
  const sinLote = registro.lineas.filter((l) => l.lote === LOTE_SIN_DEFINIR).length

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full text-left p-3 hover:bg-slate-700/40 transition-colors flex items-center gap-2">
        <span className="text-slate-500 text-xs shrink-0">{abierto ? '▾' : '▸'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white truncate">{destinatario}</p>
          <p className="text-[11px] text-slate-500 truncate">
            {registro.fecha.slice(0, 10)} · {registro.codigo || 'sin código'}
          </p>
        </div>
        {sinLote > 0 && (
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-900/60 text-amber-300 shrink-0"
            title="Líneas registradas sin lote — completar cuando Entel actualice el stock">
            {sinLote} sin lote
          </span>
        )}
        <span className="text-[10px] text-slate-500 shrink-0">
          {registro.lineas.length} {registro.lineas.length === 1 ? 'ítem' : 'ítems'}
        </span>
      </button>

      {abierto && (
        // Mismo patrón de tabla que Movimientos/Bodega: el scroll horizontal
        // vive en este contenedor, no en la página. Al ser una <table> de
        // verdad, seleccionar y copiar pega con columnas en Excel/Sheets.
        <div className="border-t border-slate-700 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">SKU</th>
                <th className="px-2 py-1.5 font-medium">Material</th>
                {modo === 'asignaciones' && <th className="px-2 py-1.5 font-medium whitespace-nowrap">Tipo</th>}
                <th className="px-2 py-1.5 font-medium whitespace-nowrap">Lote</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Cantidad</th>
                <th className="px-2 py-1.5 font-medium">Nota</th>
                {puedeEditar && <th className="px-2 py-1.5 font-medium whitespace-nowrap">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {registro.lineas.map((l) => (
                <LineaRegistro key={l.id} linea={l} modo={modo} puedeEditar={puedeEditar} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LineaRegistro({ linea, modo, puedeEditar, onChanged }: {
  linea: Movimiento
  modo: 'asignaciones' | 'entrada'
  puedeEditar: boolean
  onChanged: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [lote, setLote] = useState(linea.lote)
  const [cantidad, setCantidad] = useState(String(linea.cantidad))
  const [nota, setNota] = useState(linea.nota ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function abrirEdicion() {
    setLote(linea.lote === LOTE_SIN_DEFINIR ? '' : linea.lote)
    setCantidad(String(linea.cantidad))
    setNota(linea.nota ?? '')
    setError(null)
    setEditando(true)
  }

  async function guardar() {
    const n = Number(cantidad)
    if (!Number.isFinite(n) || n <= 0) { setError('La cantidad debe ser mayor que cero'); return }
    setGuardando(true)
    setError(null)
    try {
      // Solo se manda lo que cambió: la RPC trata `null` como "no tocar".
      // Un lote borrado a mano vuelve a 'SinDefinir', que es lo que
      // `registrar_movimiento` deja cuando se registra sin lote.
      const loteNuevo = lote.trim() || LOTE_SIN_DEFINIR
      await corregirMovimiento(linea.id, {
        lote: loteNuevo !== linea.lote ? loteNuevo : undefined,
        cantidad: n !== linea.cantidad ? n : undefined,
        nota: nota !== (linea.nota ?? '') ? nota : undefined,
      })
      setEditando(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGuardando(false)
    }
  }

  async function anular() {
    const detalle = `${linea.materialSku} — ${linea.cantidad} (lote ${linea.lote})`
    if (!confirm(`¿Anular esta línea?\n\n${detalle}\n\nRevierte el stock que movió y borra el registro. No se puede deshacer.`)) return
    setGuardando(true)
    setError(null)
    try {
      await anularMovimiento(linea.id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardando(false)
    }
  }

  const inputCls = 'bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none w-full'
  const tdCls = 'px-2 py-2 whitespace-nowrap'
  // SKU, Material, Lote, Cantidad, Nota + las dos condicionales.
  const totalCols = 5 + (modo === 'asignaciones' ? 1 : 0) + (puedeEditar ? 1 : 0)

  return (
    <>
      <tr className={`border-t border-slate-700 divide-x divide-slate-700 ${editando ? 'bg-slate-900/60' : 'bg-slate-800/60'}`}>
        <td className={`${tdCls} text-slate-300`}>{linea.materialSku}</td>
        <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{linea.materialDescripcion}</p></td>
        {modo === 'asignaciones' && (
          <td className={`${tdCls} text-slate-300`}>{TIPO_LABELS[linea.tipo] ?? linea.tipo}</td>
        )}

        <td className={tdCls}>
          {editando ? (
            // Texto libre a propósito: el lote que hay que anotar acá muchas
            // veces todavía no existe en `stock`, así que un desplegable de
            // lotes conocidos (LoteSelect) no serviría justo para este caso.
            <input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Sin lote"
              autoFocus className={`${inputCls} min-w-[7rem]`} />
          ) : linea.lote === LOTE_SIN_DEFINIR ? (
            <span className="text-amber-400">sin lote</span>
          ) : (
            <span className="text-slate-300">{linea.lote}</span>
          )}
        </td>

        <td className={`${tdCls} text-right`}>
          {editando ? (
            <input type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
              className={`${inputCls} text-right min-w-[4.5rem]`} />
          ) : (
            <span className="font-semibold text-white">{linea.cantidad}</span>
          )}
        </td>

        <td className="px-2 py-2 max-w-[220px]">
          {editando ? (
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional"
              className={`${inputCls} min-w-[8rem]`} />
          ) : (
            <p className="text-slate-400 truncate">{linea.nota || '—'}</p>
          )}
        </td>

        {puedeEditar && (
          <td className={tdCls}>
            {editando ? (
              <span className="inline-flex items-center gap-2">
                <button type="button" onClick={guardar} disabled={guardando}
                  className="text-[10px] font-semibold text-brand-400 hover:text-brand-300 disabled:opacity-40">
                  {guardando ? '…' : '✓ Guardar'}
                </button>
                <button type="button" onClick={() => setEditando(false)} disabled={guardando}
                  className="text-[10px] text-slate-500 hover:text-slate-300">✕</button>
                <button type="button" onClick={anular} disabled={guardando}
                  className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40">🗑</button>
              </span>
            ) : (
              <button type="button" onClick={abrirEdicion}
                className="text-[10px] text-brand-400 hover:text-brand-300">✎ Editar</button>
            )}
          </td>
        )}
      </tr>

      {error && (
        <tr className="bg-slate-800/60">
          <td colSpan={totalCols} className="px-2 pb-2 text-[11px] text-red-400">{error}</td>
        </tr>
      )}
    </>
  )
}
