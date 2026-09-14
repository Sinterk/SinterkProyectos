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
import { useNavigate } from 'react-router-dom'
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

/** Grilla fija de 6 semanas (42 días), lunes primero — siempre alcanza para cualquier mes. */
function buildGrid(year: number, month: number): Date[] {
  const primero = new Date(year, month, 1)
  const offset = (primero.getDay() + 6) % 7 // 0=lunes … 6=domingo
  const inicio = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i))
}

export function CalendarioOtt() {
  const navigate = useNavigate()
  const rol = useAuth((s) => s.profile?.rol)
  const puedeEditarFeriados = rol === 'admin' || rol === 'jp'

  const hoy = new Date()
  const [year, setYear] = useState(hoy.getFullYear())
  const [month, setMonth] = useState(hoy.getMonth()) // 0-indexado (convención JS)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)

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

  // Clic en una celda del calendario: selecciona (o deselecciona, si ya lo
  // estaba) y salta el mes ahí si hacía falta.
  function elegirDia(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return // defensivo: nunca debería llegar acá un iso mal formado
    setYear(y)
    setMonth(m - 1)
    setSeleccionada((prev) => (prev === iso ? null : iso))
  }

  // A diferencia de elegirDia, esto NO alterna: escribir la misma fecha de
  // nuevo en el input debe dejarla seleccionada, no sacarla.
  function seleccionarFechaDesdeInput(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return
    setYear(y)
    setMonth(m - 1)
    setSeleccionada(iso)
  }

  // Los `<input type="month">`/`<input type="date">` nativos solo entregan
  // `value` vacío o una fecha COMPLETA y válida (nunca algo a medio
  // escribir) — el guard de abajo es solo defensivo. El problema real que
  // reportó Andrés ("no se puede borrar", "solo escribir al final") era
  // otro: estos inputs quedaban controlados por `value={...}` recalculado
  // en cada render, y React les reimponía ese valor en cada tecla — el
  // navegador competía con React por el valor mostrado y el campo nunca
  // llegaba a mostrar lo que el usuario estaba tipeando a medio camino. La
  // solución (ver el `key` en el JSX) es dejarlos "no controlados": React
  // solo les fija un valor nuevo cuando cambia por otra vía (flechas de
  // mes, clic en una celda), nunca mientras se están editando ellos mismos.
  function onInputMes(value: string) {
    if (!value) return // campo vacío: se deja el mes como estaba, no hay "mes vacío" que mostrar
    const [y, m] = value.split('-').map(Number)
    if (!y || !m) return
    setYear(y)
    setMonth(m - 1)
    setSeleccionada(null)
  }

  function onInputFecha(value: string) {
    if (!value) { setSeleccionada(null); return } // limpiar el campo = volver a la vista del mes completo
    seleccionarFechaDesdeInput(value)
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
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
              Mes
              {/* No controlado a propósito (solo `key` + `defaultValue`): ver
                  el comentario largo junto a `onInputMes` más arriba — con
                  `value` controlado, React reimponía el valor viejo en cada
                  tecla y el campo no dejaba escribir/borrar con normalidad.
                  El `key` fuerza un remount (con el valor ya confirmado)
                  solo cuando el mes cambia por OTRA vía (flechas, clic en
                  una celda) — mientras se edita este mismo campo, React no
                  le toca el valor hasta que el navegador entrega uno
                  completo y válido. */}
              <input type="month" key={`mes-${year}-${month}`} defaultValue={`${year}-${pad2(month + 1)}`}
                onChange={(e) => onInputMes(e.target.value)}
                className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            </label>
            <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
              Fecha
              <input type="date" key={`fecha-${seleccionada ?? 'ninguna'}`} defaultValue={seleccionada ?? ''}
                onChange={(e) => onInputFecha(e.target.value)}
                className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="text-[9px] font-semibold text-slate-500 py-0.5">{d}</div>
          ))}
          {grid.map((d) => {
            const iso = toIso(d)
            const enMes = d.getMonth() === month
            const esFinde = d.getDay() === 0 || d.getDay() === 6
            const nombreFeriado = feriadosPorFecha.get(iso)
            const otsDia = porFecha.get(iso) ?? []
            const tieneAbierta = otsDia.some((r) => r.estado === 'activo')
            const esSeleccionada = seleccionada === iso

            let cls = 'bg-slate-900 text-slate-300 border-slate-700' // blanco = hábil
            if (esFinde || nombreFeriado) cls = 'bg-sky-950 text-sky-300 border-sky-800' // azul
            if (tieneAbierta) cls = 'bg-amber-500/90 text-slate-900 border-amber-400 font-semibold' // amarillo
            if (esSeleccionada) cls = 'bg-green-600 text-white border-green-400 font-semibold' // verde, gana siempre

            return (
              <button key={iso} type="button" onClick={() => elegirDia(iso)}
                title={[nombreFeriado, otsDia.length > 0 ? `${otsDia.length} OTT(s) abierta(s) ese día` : ''].filter(Boolean).join(' — ') || undefined}
                className={`relative h-7 sm:h-8 rounded border text-[11px] flex items-center justify-center transition-colors
                  ${enMes ? '' : 'opacity-30'} ${cls} ${iso === hoyStr ? 'ring-2 ring-white/60' : ''}`}>
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
                onSelect={() => navigate(`/att/${r.id}`, { state: { from: 'calendario' } })} />
            ))}
          </div>
        )}
      </div>
    </div>
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
