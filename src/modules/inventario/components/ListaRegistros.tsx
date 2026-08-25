// Lista de lo ya registrado, bajo el formulario de Registro (Asignaciones y
// Entrada). Pedido de Andrés (11-08-2026): poder volver sobre una tanda ya
// guardada y completarle el lote, porque sin SAP el lote real muchas veces se
// sabe solo después, cuando Entel actualiza su stock.
//
// Las tandas no existen como tabla — se arman agrupando `movimientos` por
// (día, destinatario, documento). Ver `listRegistros` en inventarioRepo.
//
// La edición es de la tanda entera, no fila por fila: cuando llega el lote de
// una entrega suele aplicar a varias líneas a la vez, y guardar de a una
// significaba una recarga por línea. Un "Editar" abre todas las filas y un
// "Guardar" manda solo las que cambiaron.

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { listRegistros, corregirMovimiento, anularMovimiento } from '@/lib/inventario/inventarioRepo'
import type { RegistroAgrupado } from '@/lib/inventario/inventarioRepo'
import type { Movimiento } from '@/lib/inventario/types'
import { LoteSelect } from '@/ui/LoteSelect'

const LOTE_SIN_DEFINIR = 'SinDefinir'

const TIPO_LABELS: Record<string, string> = {
  entrada: 'Entrada', salida: 'Entrega', traslado: 'Devolución', ajuste: 'Conteo',
}

/** Valores en edición de una fila. Se guardan como texto: son lo que hay en los inputs. */
interface Draft {
  lote: string
  cantidad: string
  nota: string
}

function draftDe(l: Movimiento): Draft {
  return {
    // 'SinDefinir' es un marcador interno, no algo que Andrés deba borrar a
    // mano antes de escribir el lote real: se muestra vacío.
    lote: l.lote === LOTE_SIN_DEFINIR ? '' : l.lote,
    cantidad: String(l.cantidad),
    nota: l.nota ?? '',
  }
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
  const [editando, setEditando] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [guardando, setGuardando] = useState(false)
  // Por fila, para poder decir cuál falló cuando se guardan varias juntas.
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)

  const destinatario = modo === 'asignaciones'
    ? (registro.tecnicoNombre ?? 'Sin técnico')
    : (registro.bodegaNombre ?? 'Sin bodega')
  const sinLote = registro.lineas.filter((l) => l.lote === LOTE_SIN_DEFINIR).length

  function abrirEdicion() {
    setDrafts(Object.fromEntries(registro.lineas.map((l) => [l.id, draftDe(l)])))
    setErrores({})
    setAviso(null)
    setEditando(true)
  }

  function cancelar() {
    setEditando(false)
    setDrafts({})
    setErrores({})
    setAviso(null)
  }

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function guardarTodo() {
    setGuardando(true)
    setErrores({})
    setAviso(null)

    const erroresNuevos: Record<string, string> = {}
    let guardadas = 0

    // Secuencial a propósito: cada corrección rehace stock por dentro
    // (revierte lo viejo, aplica lo nuevo), y si dos filas tocan el mismo
    // material+lote en paralelo el saldo intermedio queda a merced del orden
    // en que lleguen. Además así el error queda atribuido a su fila.
    for (const linea of registro.lineas) {
      const d = drafts[linea.id]
      if (!d) continue

      const loteNuevo = d.lote.trim() || LOTE_SIN_DEFINIR
      const cantidadNueva = Number(d.cantidad)
      const notaNueva = d.nota.trim()

      const cambioLote = loteNuevo !== linea.lote
      const cambioCantidad = cantidadNueva !== linea.cantidad
      const cambioNota = notaNueva !== (linea.nota ?? '')
      if (!cambioLote && !cambioCantidad && !cambioNota) continue

      if (!Number.isFinite(cantidadNueva) || cantidadNueva <= 0) {
        erroresNuevos[linea.id] = 'La cantidad debe ser mayor que cero'
        continue
      }

      try {
        await corregirMovimiento(linea.id, {
          lote: cambioLote ? loteNuevo : undefined,
          cantidad: cambioCantidad ? cantidadNueva : undefined,
          nota: cambioNota ? notaNueva : undefined,
        })
        guardadas++
      } catch (err) {
        erroresNuevos[linea.id] = err instanceof Error ? err.message : String(err)
      }
    }

    setGuardando(false)

    if (Object.keys(erroresNuevos).length === 0) {
      // Todo bien: se sale de edición y la lista se recarga con los valores
      // nuevos. `guardadas === 0` = no se tocó nada, tampoco es un error.
      setEditando(false)
      setDrafts({})
      if (guardadas > 0) onChanged()
      return
    }

    // Parcial: se queda en edición con lo tipeado intacto y el error marcado
    // en cada fila que falló. Se recarga igual para que las que sí pasaron
    // muestren su valor guardado y no se vuelvan a mandar al reintentar.
    setErrores(erroresNuevos)
    setAviso(guardadas > 0
      ? `${guardadas} ${guardadas === 1 ? 'línea guardada' : 'líneas guardadas'}, ${Object.keys(erroresNuevos).length} con error.`
      : null)
    if (guardadas > 0) onChanged()
  }

  async function anular(linea: Movimiento) {
    const detalle = `${linea.materialSku} — ${linea.cantidad} (lote ${linea.lote})`
    if (!confirm(`¿Anular esta línea?\n\n${detalle}\n\nRevierte el stock que movió y borra el registro. No se puede deshacer.`)) return
    setGuardando(true)
    try {
      await anularMovimiento(linea.id)
      setEditando(false)
      setDrafts({})
      onChanged()
    } catch (err) {
      setErrores((prev) => ({ ...prev, [linea.id]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setGuardando(false)
    }
  }

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
        <>
          {puedeEditar && (
            <div className="border-t border-slate-700 px-3 py-2 flex items-center gap-2">
              {editando ? (
                <>
                  <button type="button" onClick={guardarTodo} disabled={guardando}
                    className="text-xs font-semibold py-1.5 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
                    {guardando ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                  <button type="button" onClick={cancelar} disabled={guardando}
                    className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200">
                    Cancelar
                  </button>
                  <span className="text-[10px] text-slate-500 ml-auto">Se guardan solo las filas que cambiaste.</span>
                </>
              ) : (
                <button type="button" onClick={abrirEdicion}
                  className="text-xs font-semibold py-1.5 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200">
                  ✎ Editar líneas
                </button>
              )}
            </div>
          )}

          {aviso && <p className="px-3 pb-2 text-[11px] text-amber-400">{aviso}</p>}

          {/* Mismo patrón de tabla que Movimientos/Bodega: el scroll horizontal
              vive en este contenedor, no en la página. Al ser una <table> de
              verdad, seleccionar y copiar pega con columnas en Excel/Sheets. */}
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
                {registro.lineas.map((l, i) => (
                  <LineaRegistro key={l.id} linea={l} modo={modo} puedeEditar={puedeEditar}
                    draft={editando ? drafts[l.id] : undefined}
                    autoFocus={editando && i === 0}
                    error={errores[l.id]}
                    guardando={guardando}
                    onDraftChange={(patch) => setDraft(l.id, patch)}
                    onAnular={() => anular(l)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function LineaRegistro({ linea, modo, puedeEditar, draft, autoFocus, error, guardando, onDraftChange, onAnular }: {
  linea: Movimiento
  modo: 'asignaciones' | 'entrada'
  puedeEditar: boolean
  /** undefined = fila en solo lectura; presente = la tanda está en edición. */
  draft: Draft | undefined
  autoFocus: boolean
  error: string | undefined
  guardando: boolean
  onDraftChange: (patch: Partial<Draft>) => void
  onAnular: () => void
}) {
  const inputCls = 'bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none w-full'
  const tdCls = 'px-2 py-2 whitespace-nowrap'
  // SKU, Material, Lote, Cantidad, Nota + las dos condicionales.
  const totalCols = 5 + (modo === 'asignaciones' ? 1 : 0) + (puedeEditar ? 1 : 0)

  return (
    <>
      <tr className={`border-t border-slate-700 divide-x divide-slate-700 ${
        error ? 'bg-red-950/30' : draft ? 'bg-slate-900/60' : 'bg-slate-800/60'}`}>
        <td className={`${tdCls} text-slate-300`}>{linea.materialSku}</td>
        <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{linea.materialDescripcion}</p></td>
        {modo === 'asignaciones' && (
          <td className={`${tdCls} text-slate-300`}>{TIPO_LABELS[linea.tipo] ?? linea.tipo}</td>
        )}

        <td className={tdCls}>
          {draft ? (
            modo === 'entrada' ? (
              // Desplegable de lotes ya conocidos en digital (el código real
              // de SAP) + "+ Lote nuevo…" para digitar uno que todavía no
              // existe. Se muestra SIEMPRE, incluso para Ferretería — el
              // físico de Ferretería sigue sin distinguir lote (el servidor
              // lo deja fijo en 'Físico'), pero el lote real que entrega SAP
              // igual importa para que el inventario digital calce con SAP
              // (ver 0066_entrada_ferreteria_con_lote.sql).
              <LoteSelect materialId={linea.materialId} ubicacionId={null} naturaleza="digital"
                checkAvailability={false} value={draft.lote} onChange={(lote) => onDraftChange({ lote })}
                buscarTodasBodegas soloConDisponible className={`${inputCls} min-w-[7rem]`} />
            ) : (
              <input value={draft.lote} onChange={(e) => onDraftChange({ lote: e.target.value })}
                placeholder="Sin lote" autoFocus={autoFocus} className={`${inputCls} min-w-[7rem]`} />
            )
          ) : linea.lote === LOTE_SIN_DEFINIR ? (
            <span className="text-amber-400">sin lote</span>
          ) : (
            <span className="text-slate-300">{linea.lote}</span>
          )}
        </td>

        <td className={`${tdCls} text-right`}>
          {draft ? (
            <input type="number" min="0" step="any" value={draft.cantidad}
              onChange={(e) => onDraftChange({ cantidad: e.target.value })}
              className={`${inputCls} text-right min-w-[4.5rem]`} />
          ) : (
            <span className="font-semibold text-white">{linea.cantidad}</span>
          )}
        </td>

        <td className="px-2 py-2 max-w-[220px]">
          {draft ? (
            <input value={draft.nota} onChange={(e) => onDraftChange({ nota: e.target.value })}
              placeholder="Opcional" className={`${inputCls} min-w-[8rem]`} />
          ) : (
            <p className="text-slate-400 truncate">{linea.nota || '—'}</p>
          )}
        </td>

        {puedeEditar && (
          <td className={tdCls}>
            <button type="button" onClick={onAnular} disabled={guardando}
              className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40">
              🗑 Anular
            </button>
          </td>
        )}
      </tr>

      {error && (
        <tr className="bg-red-950/30">
          <td colSpan={totalCols} className="px-2 pb-2 text-[11px] text-red-400">{error}</td>
        </tr>
      )}
    </>
  )
}
