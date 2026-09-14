// Vista de calendario de OTTs (pedido de Andrés) — complementa la lista de
// Home.tsx con una vista de mes: día seleccionado (o mes completo, si no se
// eligió día) muestra las OTTs correspondientes, y los días con alguna OTT
// todavía no cerrada quedan resaltados en amarillo.
//
// "Fecha de la OTT" = `fechaInicioDe()` (fechaInicio a mano, o la fecha de
// creación si no tiene — mismo criterio que ya usa la tarjeta de Home.tsx,
// para no tener dos definiciones de "cuándo se abrió" en la misma app).
//
// Colores de celda, en orden de prioridad (el primero que aplica gana):
// verde = día seleccionado; amarillo = alguna OTT con fecha de apertura ese
// día que TODAVÍA está activa (no cerrada) — si ya se cerró, no pinta el
// día, aunque siga apareciendo en el listado; azul = fin de semana o
// feriado; blanco = día hábil sin OTT abierta.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { attRepo } from '../data/attRepo'
import { fechaInicioDe } from '../utils/fechaInicio'
import { TIPO_PROYECTO_LABELS } from '../types'
import type { AttRecord } from '../types'
import { useAuth } from '@/lib/auth'
import { listFeriados, crearFeriado, eliminarFeriado } from '@/lib/feriadosRepo'
import type { Feriado } from '@/lib/feriadosRepo'

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
/** "YYYY-MM-DD" en hora LOCAL — evitar toISOString() acá, que corta en UTC y puede correr el día. */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function hoyIso(): string {
  return toIso(new Date())
}
/** "YYYY-MM-DD" → "DD-MM-YYYY" (formato natural para tipear a mano en Chile). */
function formatDmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}
/** "DD-MM-YYYY" → "YYYY-MM-DD", o null si no es una fecha real (incluye 31-02-2026, etc.). */
function parseDmyToIso(texto: string): string | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(texto.trim())
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  const fecha = new Date(y, mo - 1, d)
  if (fecha.getFullYear() !== y || fecha.getMonth() !== mo - 1 || fecha.getDate() !== d) return null
  return `${y}-${pad2(mo)}-${pad2(d)}`
}
function formatMy(year: number, month: number): string {
  return `${pad2(month + 1)}-${year}`
}
/** "MM-YYYY" → {y, m 0-indexado}, o null si el mes no existe (13-2026, etc.). */
function parseMyToYm(texto: string): { y: number; m: number } | null {
  const match = /^(\d{1,2})-(\d{4})$/.exec(texto.trim())
  if (!match) return null
  const mo = Number(match[1])
  const y = Number(match[2])
  if (mo < 1 || mo > 12) return null
  return { y, m: mo - 1 }
}

/** Grilla fija de 6 semanas (42 días), lunes primero — siempre alcanza para cualquier mes. */
function buildGrid(year: number, month: number): Date[] {
  const primero = new Date(year, month, 1)
  const offset = (primero.getDay() + 6) % 7 // 0=lunes … 6=domingo
  const inicio = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i))
}

/** Clases + tooltip de una celda — compartido entre la grilla grande y el mini-calendario del input de Fecha. */
function celda(d: Date, seleccionada: string | null, feriadosPorFecha: Map<string, string>, porFecha: Map<string, AttRecord[]>, hoyStr: string) {
  const iso = toIso(d)
  const esFinde = d.getDay() === 0 || d.getDay() === 6
  const nombreFeriado = feriadosPorFecha.get(iso)
  const otsDia = porFecha.get(iso) ?? []
  const tieneAbierta = otsDia.some((r) => r.estado === 'activo')
  const esSeleccionada = seleccionada === iso

  let cls = 'bg-slate-900 text-slate-300 border-slate-700' // blanco = hábil
  if (esFinde || nombreFeriado) cls = 'bg-sky-950 text-sky-300 border-sky-800' // azul
  if (tieneAbierta) cls = 'bg-amber-500/90 text-slate-900 border-amber-400 font-semibold' // amarillo
  if (esSeleccionada) cls = 'bg-green-600 text-white border-green-400 font-semibold' // verde, gana siempre
  if (iso === hoyStr) cls += ' ring-2 ring-white/60'

  const title = [nombreFeriado, otsDia.length > 0 ? `${otsDia.length} OTT(s) abierta(s) ese día` : ''].filter(Boolean).join(' — ') || undefined
  return { iso, cls, title }
}

interface NavStateCalendario {
  from?: string
  year?: number
  month?: number
  fecha?: string | null
}

export function CalendarioOtt() {
  const navigate = useNavigate()
  const location = useLocation()
  const rol = useAuth((s) => s.profile?.rol)
  const puedeEditarFeriados = rol === 'admin' || rol === 'jp'

  // Si se vuelve de una OTT abierta desde acá mismo (Editor.tsx reenvía este
  // state al navegar de vuelta), se restaura exactamente la misma vista —
  // pedido explícito de Andrés: antes "Volver" siempre reiniciaba al mes
  // actual sin ningún día elegido.
  const navState = location.state as NavStateCalendario | null
  const hoy = new Date()
  const [year, setYear] = useState(navState?.year ?? hoy.getFullYear())
  const [month, setMonth] = useState(navState?.month ?? hoy.getMonth()) // 0-indexado (convención JS)
  const [seleccionada, setSeleccionada] = useState<string | null>(navState?.fecha ?? null)

  const [records, setRecords] = useState<AttRecord[] | null>(null)
  const [feriados, setFeriados] = useState<Feriado[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reloadRecords() {
    attRepo.list({ estado: 'todos' }).then(setRecords).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }
  function reloadFeriados() {
    listFeriados().then(setFeriados).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }
  useEffect(reloadRecords, [])
  useEffect(reloadFeriados, [])

  const feriadosPorFecha = useMemo(() => new Map((feriados ?? []).map((f) => [f.fecha, f.nombre])), [feriados])

  /** OTTs agrupadas por su fecha de apertura ("YYYY-MM-DD"). */
  const porFecha = useMemo(() => {
    const map = new Map<string, AttRecord[]>()
    for (const r of records ?? []) {
      const f = fechaInicioDe(r)
      const arr = map.get(f)
      if (arr) arr.push(r)
      else map.set(f, [r])
    }
    return map
  }, [records])

  const grid = useMemo(() => buildGrid(year, month), [year, month])

  function irAMes(y: number, m: number) {
    let mm = m
    let yy = y
    if (mm < 0) { mm = 11; yy -= 1 }
    if (mm > 11) { mm = 0; yy += 1 }
    setYear(yy)
    setMonth(mm)
  }

  function elegirMes(y: number, m: number) {
    setYear(y)
    setMonth(m)
    setSeleccionada(null)
  }

  // Clic en una celda del calendario (o del mini-calendario del input de
  // Fecha): selecciona (o deselecciona, si ya lo estaba) y salta el mes ahí
  // si hacía falta.
  function elegirDia(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return // defensivo: nunca debería llegar acá un iso mal formado
    setYear(y)
    setMonth(m - 1)
    setSeleccionada((prev) => (prev === iso ? null : iso))
  }

  // A diferencia de elegirDia, esto NO alterna: confirmar la misma fecha de
  // nuevo en el input debe dejarla seleccionada, no sacarla.
  function seleccionarFecha(iso: string | null) {
    if (!iso) { setSeleccionada(null); return }
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return
    setYear(y)
    setMonth(m - 1)
    setSeleccionada(iso)
  }

  // Listado: el día elegido si hay uno, si no todas las OTTs cuya fecha de
  // apertura cae en el mes que se está mirando.
  const listado = useMemo(() => {
    if (!records) return []
    if (seleccionada) {
      return (porFecha.get(seleccionada) ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt)
    }
    return records
      .filter((r) => {
        const [y, m] = fechaInicioDe(r).split('-').map(Number)
        return y === year && m === month + 1
      })
      .sort((a, b) => fechaInicioDe(a).localeCompare(fechaInicioDe(b)) || b.updatedAt - a.updatedAt)
  }, [records, porFecha, seleccionada, year, month])

  const hoyStr = hoyIso()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">📅 Calendario de OTTs</h1>
          <p className="text-xs text-slate-400">
            {seleccionada ? `OTTs abiertas el ${seleccionada}` : `OTTs abiertas en ${MESES[month]} ${year}`}
          </p>
        </div>
        <button type="button" onClick={() => navigate('/att')}
          className="text-slate-400 hover:text-white text-sm">← Volver a la lista</button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => irAMes(year, month - 1)}
              className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm">‹</button>
            <span className="text-xs font-semibold text-white w-32 text-center">{MESES[month]} {year}</span>
            <button type="button" onClick={() => irAMes(year, month + 1)}
              className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm">›</button>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
              Mes
              <MesInput year={year} month={month} onCommit={elegirMes} />
            </label>
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
              Fecha
              <FechaInput seleccionada={seleccionada} mesYear={year} mesMonth={month}
                feriadosPorFecha={feriadosPorFecha} porFecha={porFecha} hoyStr={hoyStr}
                onCommit={seleccionarFecha} />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="text-[9px] font-semibold text-slate-500 py-0.5">{d}</div>
          ))}
          {grid.map((d) => {
            const enMes = d.getMonth() === month
            const { iso, cls, title } = celda(d, seleccionada, feriadosPorFecha, porFecha, hoyStr)
            return (
              <button key={iso} type="button" onClick={() => elegirDia(iso)} title={title}
                className={`relative h-7 sm:h-8 rounded border text-[11px] flex items-center justify-center transition-colors
                  ${enMes ? '' : 'opacity-30'} ${cls}`}>
                {d.getDate()}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-2.5 text-[9px] text-slate-400 pt-1 border-t border-slate-700">
          <Legend color="bg-slate-900 border border-slate-700" label="Hábil" />
          <Legend color="bg-sky-950 border border-sky-800" label="Fin de semana / feriado" />
          <Legend color="bg-amber-500/90" label="Con OTT abierta" />
          <Legend color="bg-green-600" label="Seleccionado" />
        </div>
      </div>

      {puedeEditarFeriados && (
        <FeriadosSection year={year} feriados={feriados ?? []} onChanged={reloadFeriados} onError={setError} />
      )}

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">
          {listado.length} OTT(s) {seleccionada ? 'ese día' : 'ese mes'}
        </h2>
        {records === null ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : listado.length === 0 ? (
          <p className="text-xs text-slate-500">Sin OTTs {seleccionada ? 'abiertas ese día' : 'ese mes'}.</p>
        ) : (
          <div className="space-y-2">
            {listado.map((r) => (
              <OttDiaCard key={r.id} record={r}
                onSelect={() => navigate(`/att/${r.id}`, { state: { from: 'calendario', year, month, fecha: seleccionada } })} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Campo de mes: texto libre ("mm-aaaa"), confirma SOLO al salir del campo
 * (blur) o Enter — nunca mientras se está tipeando. Si al confirmar no es un
 * mes válido, vuelve a mostrar el que ya estaba (no inventa uno). El botón
 * 📅 abre un mini-calendario para elegirlo sin tipear.
 *
 * Antes esto era un `<input type="month">` nativo — Firefox y Safari no lo
 * implementan de verdad (cae a un campo de texto plano, sin selector), y
 * quedaba controlado por React con el valor recalculado en cada render, así
 * que competía con el usuario por lo que se veía en pantalla mientras
 * tipeaba (bug real reportado por Andrés: "parece que se recarga con cada
 * tecla"). Un `<input type="text">` normal, controlado a mano y confirmado
 * solo al salir, no tiene ninguno de esos problemas.
 */
function MesInput({ year, month, onCommit }: { year: number; month: number; onCommit: (y: number, m: number) => void }) {
  const [draft, setDraft] = useState(formatMy(year, month))
  const [pickerAbierto, setPickerAbierto] = useState(false)
  useEffect(() => { setDraft(formatMy(year, month)) }, [year, month])

  function commit() {
    const parsed = parseMyToYm(draft)
    if (parsed) onCommit(parsed.y, parsed.m)
    else setDraft(formatMy(year, month)) // inválido → vuelve a lo que ya estaba
  }

  return (
    <span className="relative flex items-center gap-1">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="mm-aaaa" inputMode="numeric"
        className="w-20 bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      <button type="button" onClick={() => setPickerAbierto(true)} className="text-slate-400 hover:text-white text-sm" aria-label="Elegir mes">📅</button>
      {pickerAbierto && (
        <MiniMesPicker year={year} onPick={(y, m) => { onCommit(y, m); setPickerAbierto(false) }} onClose={() => setPickerAbierto(false)} />
      )}
    </span>
  )
}

/** Mismo criterio que MesInput, pero para un día completo ("dd-mm-aaaa"). Campo vacío = sin día elegido (vista de mes completo). */
function FechaInput({ seleccionada, mesYear, mesMonth, feriadosPorFecha, porFecha, hoyStr, onCommit }: {
  seleccionada: string | null
  mesYear: number
  mesMonth: number
  feriadosPorFecha: Map<string, string>
  porFecha: Map<string, AttRecord[]>
  hoyStr: string
  onCommit: (iso: string | null) => void
}) {
  const [draft, setDraft] = useState(seleccionada ? formatDmy(seleccionada) : '')
  const [pickerAbierto, setPickerAbierto] = useState(false)
  useEffect(() => { setDraft(seleccionada ? formatDmy(seleccionada) : '') }, [seleccionada])

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed) { onCommit(null); return }
    const iso = parseDmyToIso(trimmed)
    if (iso) onCommit(iso)
    else setDraft(seleccionada ? formatDmy(seleccionada) : '') // inválido → vuelve a lo que ya estaba
  }

  return (
    <span className="relative flex items-center gap-1">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="dd-mm-aaaa" inputMode="numeric"
        className="w-24 bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      <button type="button" onClick={() => setPickerAbierto(true)} className="text-slate-400 hover:text-white text-sm" aria-label="Elegir fecha">📅</button>
      {pickerAbierto && (
        <MiniDiaPicker initialYear={mesYear} initialMonth={mesMonth} seleccionada={seleccionada}
          feriadosPorFecha={feriadosPorFecha} porFecha={porFecha} hoyStr={hoyStr}
          onPick={(iso) => { onCommit(iso); setPickerAbierto(false) }} onClose={() => setPickerAbierto(false)} />
      )}
    </span>
  )
}

// Mismo patrón de posición que MaterialSelect.tsx (fixed, anclado al
// viewport, no al botón) — probado en este mismo proyecto como el que sí
// funciona bien en celular; anclar al botón con getBoundingClientRect dejaba
// paneles perdidos apenas el navegador scrolleaba.
function PopoverShell({ children, onClose, width }: { children: React.ReactNode; onClose: () => void; width: string }) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className={`fixed z-50 top-16 left-1/2 -translate-x-1/2 ${width} bg-slate-800 border border-slate-600 rounded-xl shadow-lg p-3 space-y-2`}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>,
    document.body,
  )
}

function MiniMesPicker({ year, onPick, onClose }: { year: number; onPick: (y: number, m: number) => void; onClose: () => void }) {
  const [y, setY] = useState(year)
  return (
    <PopoverShell onClose={onClose} width="w-64">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setY((v) => v - 1)} className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm">‹</button>
        <span className="text-sm font-semibold text-white">{y}</span>
        <button type="button" onClick={() => setY((v) => v + 1)} className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm">›</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MESES.map((nombre, i) => (
          <button key={nombre} type="button" onClick={() => onPick(y, i)}
            className="text-xs py-1.5 rounded-lg bg-slate-700 hover:bg-brand-600 text-white transition-colors">
            {nombre.slice(0, 3)}
          </button>
        ))}
      </div>
    </PopoverShell>
  )
}

function MiniDiaPicker({ initialYear, initialMonth, seleccionada, feriadosPorFecha, porFecha, hoyStr, onPick, onClose }: {
  initialYear: number
  initialMonth: number
  seleccionada: string | null
  feriadosPorFecha: Map<string, string>
  porFecha: Map<string, AttRecord[]>
  hoyStr: string
  onPick: (iso: string) => void
  onClose: () => void
}) {
  const [y, setY] = useState(initialYear)
  const [m, setM] = useState(initialMonth)
  const grid = useMemo(() => buildGrid(y, m), [y, m])

  function irAMes(delta: number) {
    let mm = m + delta
    let yy = y
    if (mm < 0) { mm = 11; yy -= 1 }
    if (mm > 11) { mm = 0; yy += 1 }
    setY(yy)
    setM(mm)
  }

  return (
    <PopoverShell onClose={onClose} width="w-72">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => irAMes(-1)} className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm">‹</button>
        <span className="text-sm font-semibold text-white">{MESES[m]} {y}</span>
        <button type="button" onClick={() => irAMes(1)} className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DIAS_SEMANA.map((d) => <div key={d} className="text-[9px] font-semibold text-slate-500">{d}</div>)}
        {grid.map((d) => {
          const enMes = d.getMonth() === m
          const { iso, cls, title } = celda(d, seleccionada, feriadosPorFecha, porFecha, hoyStr)
          return (
            <button key={iso} type="button" onClick={() => onPick(iso)} title={title}
              className={`h-7 rounded border text-[11px] flex items-center justify-center ${enMes ? '' : 'opacity-30'} ${cls}`}>
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </PopoverShell>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded ${color}`} />
      {label}
    </span>
  )
}

function OttDiaCard({ record, onSelect }: { record: AttRecord; onSelect: () => void }) {
  const tipoLabel = record.tipoProyecto ? TIPO_PROYECTO_LABELS[record.tipoProyecto] : null
  return (
    <button type="button" onClick={onSelect}
      className="w-full text-left bg-slate-800 rounded-xl border border-slate-700 hover:border-brand-500 transition-colors p-3">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        {tipoLabel && <span className="text-[10px] font-medium text-brand-400 uppercase tracking-wide">{tipoLabel}</span>}
        <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${record.estado === 'cerrado' ? 'bg-slate-700 text-slate-400' : 'bg-green-900/50 text-green-400'}`}>
          {record.estado === 'cerrado' ? `🔒 Cerrado${record.fechaCierre ? ` ${record.fechaCierre}` : ''}` : '🟢 Abierto'}
        </span>
      </div>
      <div className="text-sm font-semibold text-white">
        {record.ott ? <>OTT <span className="font-mono">{record.ott}</span></> : <span className="text-slate-500 font-normal">Sin número OTT</span>}
      </div>
      {record.nombreProyecto && <div className="text-xs text-slate-300 mt-0.5 truncate">{record.nombreProyecto}</div>}
      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
        <span>📅 Apertura {fechaInicioDe(record)}</span>
        {record.comuna && <span>📍 {record.comuna}</span>}
      </div>
    </button>
  )
}

/**
 * Feriados es un catálogo abierto chico (fecha + nombre) — se edita acá
 * mismo, en vez de en Catálogo de Inventario (sin relación con materiales;
 * nadie que gestione OTTs va a ir a buscarlo ahí). Solo admin/jp lo ve.
 */
function FeriadosSection({ year, feriados, onChanged, onError }: {
  year: number
  feriados: Feriado[]
  onChanged: () => void
  onError: (msg: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [fecha, setFecha] = useState('')
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)

  const delAnio = feriados.filter((f) => f.fecha.startsWith(`${year}-`))

  async function agregar() {
    if (!fecha || !nombre.trim()) return
    setGuardando(true)
    try {
      await crearFeriado(fecha, nombre)
      setFecha('')
      setNombre('')
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setGuardando(false)
    }
  }

  async function quitar(f: Feriado) {
    if (!confirm(`¿Quitar "${f.nombre}" (${f.fecha}) de los feriados?`)) return
    try {
      await eliminarFeriado(f.fecha)
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-brand-400 uppercase tracking-wide">
        <span>Feriados {year} ({delAnio.length})</span>
        <span className="text-slate-500 normal-case">{abierto ? '▲ ocultar' : '▼ editar'}</span>
      </button>
      {abierto && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {delAnio.map((f) => (
              <span key={f.fecha} className="inline-flex items-center gap-1 bg-slate-700 text-slate-200 text-[11px] rounded-full px-2 py-1">
                {f.fecha} — {f.nombre}
                <button type="button" onClick={() => quitar(f)} className="text-slate-400 hover:text-white">✕</button>
              </span>
            ))}
            {delAnio.length === 0 && <span className="text-[11px] text-slate-500">Sin feriados agregados para {year}.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del feriado…"
              onKeyDown={(e) => e.key === 'Enter' && agregar()}
              className="flex-1 min-w-[10rem] bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <button type="button" onClick={agregar} disabled={guardando || !fecha || !nombre.trim()}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
              {guardando ? 'Guardando…' : '+ Agregar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
