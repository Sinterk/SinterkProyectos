import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary, MemberProfile } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import type { Profile } from '@/lib/auth'
import { LpuCodigoSelect } from '@/ui/LpuCodigoSelect'
import { MaterialSelect } from '@/ui/MaterialSelect'
import { RegistrarMovimientoForm } from '@/ui/RegistrarMovimientoForm'
import { AsignacionesForm } from './AsignacionesForm'
import { ResumenProyectoTable } from '@/ui/ResumenProyectoTable'
import { UbicacionSelect } from '@/ui/UbicacionSelect'
import { useFileDrop } from '@/ui/useFileDrop'
import {
  getStock, getTecnicoLedger, listMovimientos, anularMovimiento, listMateriales, listUbicaciones,
  updateMaterialStockMinimo, updateMaterialComentario, updateMaterialTendido, crearMaterial,
  listMaterialTipos, crearMaterialTipo, updateMaterialApodo, updateMaterialTipo,
  listProveedores, crearProveedor, updateMaterialProveedores,
  listConteos, getConteoLineas, abrirConteo, agregarLineaConteo, actualizarLineaConteo, cerrarConteo, descartarConteo,
  listEventosInventario, listEventosPorConteo, resolverEvento, importarFilasSapAConteo,
} from '@/lib/inventario/inventarioRepo'
import type { ListMovimientosFilters, ImportarSapResultado } from '@/lib/inventario/inventarioRepo'
import type {
  Movimiento, StockRow, TecnicoLedgerRow, Ubicacion, Material, MaterialTipo, Proveedor,
  Conteo, ConteoLinea, EventoInventario, EventoResolucion, ResolucionTipo, ConsumoArea,
} from '@/lib/inventario/types'
import { parseArchivoXlsx, parseTextoPegado } from '@/lib/inventario/importarSap'
import type { FilaImportSap } from '@/lib/inventario/importarSap'
import { compareSku } from '@/lib/inventario/sku'
import {
  listLpuCodigos, listLpuMaterialMapPorMaterial, crearLpuMaterialMap, actualizarLpuMaterialMap, borrarLpuMaterialMap,
  listLpuTendidoMap, crearLpuTendidoMap, actualizarLpuTendidoMap, borrarLpuTendidoMap,
} from '@/lib/lpu/lpuRepo'
import type { LpuCodigo, LpuMaterialMap, LpuTendidoMap } from '@/lib/lpu/types'
import { ColumnHeader } from '@/ui/ColumnHeader'

type MainTab = 'movimientos' | 'bodega' | 'proyecto' | 'tecnico' | 'conteo' | 'catalogo'

const TIPO_LABELS_MOV: Record<string, string> = {
  entrada: 'Entrada', salida: 'Salida', traslado: 'Traslado/Devuelto',
  rebaja: 'Rebajado (SAP)', solicitud: 'Solicitud', instalado: 'Instalado', merma: 'Merma',
  traslado_bodega: 'Traspaso entre bodegas', ajuste: 'Ajuste (Conteo)',
}

const inputCls = 'bg-slate-800 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-700 focus:border-brand-500 focus:outline-none'

export function Home() {
  const [tab, setTab] = useState<MainTab>('movimientos')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">📦 Inventario</h1>
        <p className="text-xs text-slate-400">Materiales, stock y movimientos.</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <TabButton active={tab === 'movimientos'} onClick={() => setTab('movimientos')}>Entradas/Salidas</TabButton>
        <TabButton active={tab === 'bodega'} onClick={() => setTab('bodega')}>Bodega</TabButton>
        <TabButton active={tab === 'proyecto'} onClick={() => setTab('proyecto')}>Proyecto</TabButton>
        <TabButton active={tab === 'tecnico'} onClick={() => setTab('tecnico')}>Técnico</TabButton>
        <TabButton active={tab === 'conteo'} onClick={() => setTab('conteo')}>Conteo</TabButton>
        <TabButton active={tab === 'catalogo'} onClick={() => setTab('catalogo')}>Catálogo</TabButton>
      </div>

      {tab === 'movimientos' && <EntradasSalidasTab />}
      {tab === 'bodega' && <BodegaTab />}
      {tab === 'proyecto' && <ProyectoTab />}
      {tab === 'tecnico' && <TecnicoTab />}
      {tab === 'conteo' && <ConteoTab />}
      {tab === 'catalogo' && <CatalogoTab />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 ${active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
      {children}
    </button>
  )
}

function EntradasSalidasTab() {
  const [sub, setSub] = useState<'registro' | 'movimientos'>('registro')
  const [registroTipo, setRegistroTipo] = useState<'entrada' | 'asignaciones'>('asignaciones')
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setSub('registro')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${sub === 'registro' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          Registro
        </button>
        <button type="button" onClick={() => setSub('movimientos')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${sub === 'movimientos' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          Movimientos
        </button>
      </div>
      {sub === 'registro' ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setRegistroTipo('asignaciones')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${registroTipo === 'asignaciones' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Asignaciones
            </button>
            <button type="button" onClick={() => setRegistroTipo('entrada')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${registroTipo === 'entrada' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Entrada
            </button>
          </div>
          {registroTipo === 'asignaciones'
            ? <AsignacionesForm onRegistered={() => setRefreshKey((k) => k + 1)} />
            : <RegistrarMovimientoForm soloEntrada onRegistered={() => setRefreshKey((k) => k + 1)} />}
        </div>
      ) : (
        <MovimientosTab refreshKey={refreshKey} />
      )}
    </div>
  )
}

type MovColKey = 'fecha' | 'tipo' | 'sku' | 'material' | 'lote' | 'cantidad' | 'bodega' | 'proyecto' | 'area' | 'tecnico' | 'nota'

const MOV_COLUMNS: { key: MovColKey; label: string; numeric?: boolean; align?: 'right' }[] = [
  { key: 'fecha', label: 'Fecha' },
  { key: 'tipo', label: 'Tipo' },
  { key: 'sku', label: 'SKU', numeric: true },
  { key: 'material', label: 'Material' },
  { key: 'lote', label: 'Lote' },
  { key: 'cantidad', label: 'Cantidad', numeric: true, align: 'right' },
  { key: 'bodega', label: 'Bodega' },
  { key: 'proyecto', label: 'Proyecto' },
  { key: 'area', label: 'Área' },
  { key: 'tecnico', label: 'Técnico' },
  { key: 'nota', label: 'Nota' },
]

const SIN_PROYECTO = 'Sin proyecto'

/**
 * Etiqueta de la columna Proyecto. La reasignación a preventivo ("Asignado a
 * técnico" en la tabla del proyecto) deja el movimiento SIN `project_id` a
 * propósito — el material ya está con el técnico, no pertenece más al
 * proyecto — pero sí guarda de dónde salió en `documento`
 * ("PREVENTIVO - <código>", ver 0051_preventivo_documento.sql). Antes esas
 * filas se veían solo como "—"; ahora se muestran como "Sobrante (<código>)".
 */
function etiquetaProyecto(m: Movimiento): string | null {
  if (m.projectOtt) return m.projectOtt
  const doc = m.documento?.trim() ?? ''
  const PREFIJO = 'PREVENTIVO - '
  if (doc.startsWith(PREFIJO)) return `Sobrante (${doc.slice(PREFIJO.length)})`
  return null
}
const SIN_AREA = 'Sin área'
const SIN_TECNICO = 'Sin técnico'
const SIN_NOTA = 'Sin nota'

function movColValue(m: Movimiento, key: MovColKey): string | number {
  switch (key) {
    case 'fecha': return m.fecha.slice(0, 10) // YYYY-MM-DD: ordena bien como string, sin ambigüedad de zona horaria
    case 'tipo': return TIPO_LABELS_MOV[m.tipo] ?? m.tipo
    case 'sku': return m.materialSku
    case 'material': return m.materialDescripcion
    case 'lote': return m.lote
    case 'cantidad': return m.cantidad
    case 'bodega': return m.ubicacionDestinoNombre ? `${m.ubicacionNombre} → ${m.ubicacionDestinoNombre}` : m.ubicacionNombre
    case 'proyecto': return etiquetaProyecto(m) ?? ''
    case 'area': return m.area ?? ''
    case 'tecnico': return m.usuarioNombre ?? ''
    case 'nota': return m.nota ?? ''
  }
}

/** Igual que stockColDisplayValue: texto para el checklist de filtro (por eso los campos vacíos se ven como "Sin X", no como cadena vacía). */
function movColDisplayValue(m: Movimiento, key: MovColKey): string {
  if (key === 'proyecto') return etiquetaProyecto(m) || SIN_PROYECTO
  if (key === 'area') return m.area || SIN_AREA
  if (key === 'tecnico') return m.usuarioNombre || SIN_TECNICO
  if (key === 'nota') return m.nota?.trim() ? m.nota : SIN_NOTA
  return String(movColValue(m, key))
}

function sortMovColumnValues(key: MovColKey, values: string[]): string[] {
  if (key === 'sku') return [...values].sort((a, b) => compareSku(a, b, 'asc'))
  if (key === 'cantidad') return [...values].sort((a, b) => Number(a) - Number(b))
  if (key === 'fecha') return [...values].sort((a, b) => a.localeCompare(b))
  return [...values].sort((a, b) => a.localeCompare(b))
}

function MovimientosTab({ refreshKey }: { refreshKey: number }) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeAnular = rol === 'admin' || rol === 'jp' || rol === 'log'
  const [rows, setRows] = useState<Movimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [search, setSearch] = useState('')
  const [anulando, setAnulando] = useState<string | null>(null)

  // Mismo patrón que BodegaTab: orden por defecto (acá, el que ya trae la API —
  // fecha desc) reemplazado por un solo clic en una columna; filtro tipo Google
  // Sheets por columna, además del buscador de texto libre.
  const [sort, setSort] = useState<{ key: MovColKey; dir: 'asc' | 'desc' } | null>(null)
  const [colSelected, setColSelected] = useState<Partial<Record<MovColKey, Set<string>>>>({})
  const [openMenu, setOpenMenu] = useState<MovColKey | null>(null)

  async function reload() {
    try {
      const filters: ListMovimientosFilters = {}
      if (desde) filters.desde = new Date(desde).toISOString()
      if (hasta) filters.hasta = new Date(`${hasta}T23:59:59`).toISOString()
      setRows(await listMovimientos(filters))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [desde, hasta, refreshKey])

  async function handleAnular(m: Movimiento) {
    const detalle = `${TIPO_LABELS_MOV[m.tipo] ?? m.tipo} — ${m.materialSku} (${m.cantidad}) — ${m.fecha.slice(0, 10)}`
    if (!confirm(`¿Anular este movimiento?\n\n${detalle}\n\nEsto revierte el stock que movió y borra el registro. No se puede deshacer.`)) return
    setAnulando(m.id)
    setError(null)
    try {
      await anularMovimiento(m.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnulando(null)
    }
  }

  const q = search.trim().toLowerCase()
  const searched = (rows ?? []).filter((m) => !q
    || m.materialSku.toLowerCase().includes(q)
    || m.materialDescripcion.toLowerCase().includes(q)
    || m.ubicacionNombre.toLowerCase().includes(q)
    || (m.usuarioNombre ?? '').toLowerCase().includes(q)
    || (m.projectOtt ?? '').toLowerCase().includes(q)
    || (m.nota ?? '').toLowerCase().includes(q))

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<MovColKey, string[]>
    for (const col of MOV_COLUMNS) {
      result[col.key] = sortMovColumnValues(col.key, [...new Set(searched.map((m) => movColDisplayValue(m, col.key)))])
    }
    return result
  }, [searched])

  const displayRows = useMemo(() => {
    let out = searched
    for (const key of Object.keys(colSelected) as MovColKey[]) {
      const set = colSelected[key]
      if (!set) continue
      out = out.filter((m) => set.has(movColDisplayValue(m, key)))
    }
    if (!sort) return out
    const sorted = [...out]
    sorted.sort((a, b) => {
      if (sort.key === 'sku') return compareSku(a.materialSku, b.materialSku, sort.dir)
      const va = movColValue(a, sort.key)
      const vb = movColValue(b, sort.key)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [searched, colSelected, sort])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…"
          className={`${inputCls} col-span-2`} />
        <div className="flex gap-1 col-span-2">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} w-full`} />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} w-full`} />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {rows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sin movimientos.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 text-slate-400 text-left divide-x divide-slate-700">
                {MOV_COLUMNS.map((col) => {
                  const colValues = valuesByColumn[col.key]
                  const colSelectedSet = colSelected[col.key]
                  return (
                    <ColumnHeader key={col.key} col={col}
                      sort={sort} onSort={(dir) => { setSort(dir ? { key: col.key, dir } : null); setOpenMenu(null) }}
                      checklist={{
                        values: colValues,
                        selected: colSelectedSet ?? null,
                        onToggleValue: (v) => setColSelected((prev) => {
                          const current = new Set(prev[col.key] ?? colValues)
                          if (current.has(v)) current.delete(v); else current.add(v)
                          const next = { ...prev }
                          if (current.size === colValues.length) delete next[col.key]
                          else next[col.key] = current
                          return next
                        }),
                        onSelectAll: () => setColSelected((prev) => {
                          const next = { ...prev }
                          delete next[col.key]
                          return next
                        }),
                        onSelectNone: () => setColSelected((prev) => ({ ...prev, [col.key]: new Set() })),
                      }}
                      open={openMenu === col.key} onToggle={() => setOpenMenu((k) => (k === col.key ? null : col.key))} />
                  )
                })}
                {puedeAnular && <th className="px-2 py-1.5 font-medium">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr><td colSpan={MOV_COLUMNS.length + (puedeAnular ? 1 : 0)} className="px-2 py-3 text-center text-slate-500">
                  Ningún resultado con los filtros de columna actuales.
                </td></tr>
              )}
              {displayRows.map((m) => (
                <tr key={m.id} className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.fecha.slice(0, 10)}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{TIPO_LABELS_MOV[m.tipo] ?? m.tipo}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.materialSku}</td>
                  <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{m.materialDescripcion}</p></td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.lote}</td>
                  <td className="px-2 py-2 text-right font-semibold text-white whitespace-nowrap">{m.cantidad}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                    {m.ubicacionDestinoNombre ? `${m.ubicacionNombre} → ${m.ubicacionDestinoNombre}` : m.ubicacionNombre}
                  </td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{etiquetaProyecto(m) ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.area ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.usuarioNombre ?? '—'}</td>
                  <td className="px-2 py-2 max-w-[220px]"><p className="text-slate-400 truncate">{m.nota ?? '—'}</p></td>
                  {puedeAnular && (
                    <td className="px-2 py-2 whitespace-nowrap">
                      <button type="button" onClick={() => handleAnular(m)} disabled={anulando === m.id}
                        className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40">
                        {anulando === m.id ? 'Anulando…' : '🗑 Anular'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type StockColKey = 'sku' | 'material' | 'bodega' | 'lote' | 'fisico' | 'digital' | 'umbral' | 'comentario'

const STOCK_COLUMNS: { key: StockColKey; label: string; numeric?: boolean; align?: 'right' }[] = [
  { key: 'sku', label: 'SKU', numeric: true },
  { key: 'material', label: 'Material' },
  { key: 'bodega', label: 'Bodega' },
  { key: 'lote', label: 'Lote' },
  { key: 'fisico', label: 'Físico', numeric: true, align: 'right' },
  { key: 'digital', label: 'Digital', numeric: true, align: 'right' },
  { key: 'umbral', label: 'Umbral', numeric: true },
  { key: 'comentario', label: 'Comentario' },
]

function stockColValue(r: StockRow, key: StockColKey): string | number {
  switch (key) {
    case 'sku': return r.materialSku
    case 'material': return r.materialDescripcion
    case 'bodega': return r.ubicacionNombre
    case 'lote': return r.lote
    case 'fisico': return r.cantidadFisico
    case 'digital': return r.cantidadDigital
    case 'umbral': return r.stockMinimo ?? Number.NEGATIVE_INFINITY
    case 'comentario': return r.comentario ?? ''
  }
}

const SIN_UMBRAL = 'Sin definir'
const SIN_COMENTARIO = 'Sin comentario'

/** Representación en texto de la celda, para el checklist de filtro (por eso umbral null se ve como "Sin definir", no como -Infinity). */
function stockColDisplayValue(r: StockRow, key: StockColKey): string {
  if (key === 'umbral') return r.stockMinimo === null ? SIN_UMBRAL : String(r.stockMinimo)
  if (key === 'comentario') return r.comentario?.trim() ? r.comentario : SIN_COMENTARIO
  const v = stockColValue(r, key)
  return String(v)
}

function sortColumnValues(key: StockColKey, values: string[]): string[] {
  if (key === 'sku') return [...values].sort((a, b) => compareSku(a, b, 'asc'))
  if (key === 'fisico' || key === 'digital') return [...values].sort((a, b) => Number(a) - Number(b))
  if (key === 'umbral') {
    return [...values].sort((a, b) => {
      if (a === SIN_UMBRAL) return 1
      if (b === SIN_UMBRAL) return -1
      return Number(a) - Number(b)
    })
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

function BodegaTab() {
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  const [ubicacionId, setUbicacionId] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Orden por defecto: Bodega, luego SKU, luego Lote. Un clic en una columna
  // reemplaza esto por un orden simple (una sola columna), como en Excel.
  const [sort, setSort] = useState<{ key: StockColKey; dir: 'asc' | 'desc' } | null>(null)
  // Filtro tipo Google Sheets (lista de valores con checkbox) en cada columna.
  // Sin entrada para una columna = sin filtro (todo seleccionado); un Set vacío = nada seleccionado.
  const [colSelected, setColSelected] = useState<Partial<Record<StockColKey, Set<string>>>>({})
  const [openMenu, setOpenMenu] = useState<StockColKey | null>(null)

  useEffect(() => { listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {}) }, [])

  async function reload() {
    try { setRows(await getStock({ ubicacionId: ubicacionId || undefined, search: search || undefined })) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ubicacionId, search])

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<StockColKey, string[]>
    for (const col of STOCK_COLUMNS) {
      result[col.key] = sortColumnValues(col.key, [...new Set((rows ?? []).map((r) => stockColDisplayValue(r, col.key)))])
    }
    return result
  }, [rows])

  const displayRows = useMemo(() => {
    if (!rows) return null
    let out = rows
    for (const key of Object.keys(colSelected) as StockColKey[]) {
      const set = colSelected[key]
      if (!set) continue
      out = out.filter((r) => set.has(stockColDisplayValue(r, key)))
    }
    const sorted = [...out]
    if (sort) {
      sorted.sort((a, b) => {
        if (sort.key === 'sku') return compareSku(a.materialSku, b.materialSku, sort.dir)
        const va = stockColValue(a, sort.key)
        const vb = stockColValue(b, sort.key)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sort.dir === 'asc' ? cmp : -cmp
      })
    } else {
      sorted.sort((a, b) =>
        a.ubicacionNombre.localeCompare(b.ubicacionNombre)
        || compareSku(a.materialSku, b.materialSku, 'asc')
        || a.lote.localeCompare(b.lote))
    }
    return sorted
  }, [rows, colSelected, sort])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar material o bodega…"
          className={inputCls} />
        <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)} className={inputCls}>
          <option value="">Todas las bodegas</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {displayRows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : rows && rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sin stock registrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 text-slate-400 text-left divide-x divide-slate-700">
                {STOCK_COLUMNS.map((col) => {
                  const colValues = valuesByColumn[col.key]
                  const colSelectedSet = colSelected[col.key]
                  return (
                    <ColumnHeader key={col.key} col={col}
                      sort={sort} onSort={(dir) => { setSort(dir ? { key: col.key, dir } : null); setOpenMenu(null) }}
                      checklist={{
                        values: colValues,
                        selected: colSelectedSet ?? null,
                        onToggleValue: (v) => setColSelected((prev) => {
                          const current = new Set(prev[col.key] ?? colValues)
                          if (current.has(v)) current.delete(v); else current.add(v)
                          const next = { ...prev }
                          if (current.size === colValues.length) delete next[col.key]
                          else next[col.key] = current
                          return next
                        }),
                        onSelectAll: () => setColSelected((prev) => {
                          const next = { ...prev }
                          delete next[col.key]
                          return next
                        }),
                        onSelectNone: () => setColSelected((prev) => ({ ...prev, [col.key]: new Set() })),
                      }}
                      open={openMenu === col.key} onToggle={() => setOpenMenu((k) => (k === col.key ? null : col.key))} />
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr><td colSpan={STOCK_COLUMNS.length} className="px-2 py-3 text-center text-slate-500">
                  Ningún resultado con los filtros de columna actuales.
                </td></tr>
              )}
              {displayRows.map((r) => {
                const negativo = r.cantidadFisico < 0
                const bajoUmbral = !negativo && r.stockMinimo !== null && r.cantidadFisico <= r.stockMinimo
                return (
                  <tr key={`${r.ubicacionId}|${r.materialId}|${r.lote}`}
                    className={`border-t border-slate-700 divide-x divide-slate-700 ${negativo ? 'bg-red-950/30' : bajoUmbral ? 'bg-amber-950/20' : 'bg-slate-800/60'}`}>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.materialSku}</td>
                    <td className="px-2 py-2 max-w-[220px]">
                      <p className="text-white truncate">{r.materialDescripcion}</p>
                      {negativo && <p className="text-[10px] text-red-400">⚠ Descuadre — revisar</p>}
                      {bajoUmbral && <p className="text-[10px] text-amber-400">Renovar</p>}
                    </td>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.ubicacionNombre}</td>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.lote}</td>
                    <td className={`px-2 py-2 text-right font-semibold whitespace-nowrap ${negativo ? 'text-red-400' : bajoUmbral ? 'text-amber-400' : 'text-white'}`}>
                      {negativo && '⚠ '}{r.cantidadFisico}
                    </td>
                    <td className={`px-2 py-2 text-right whitespace-nowrap ${r.cantidadDigital < 0 ? 'text-red-400' : r.cantidadDigital !== 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {r.cantidadDigital < 0 && '⚠ '}{r.cantidadDigital}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <UmbralEditor materialId={r.materialId} value={r.stockMinimo} onSaved={reload} />
                    </td>
                    <td className="px-2 py-2 max-w-[220px]">
                      <ComentarioEditor materialId={r.materialId} value={r.comentario} onSaved={reload} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UmbralEditor({ materialId, value, onSaved }: { materialId: string; value: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateMaterialStockMinimo(materialId, draft.trim() === '' ? null : Number(draft))
      setEditing(false)
      onSaved()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(value !== null ? String(value) : ''); setEditing(true) }}
        className="text-[10px] text-slate-500 hover:text-brand-400 underline decoration-dotted">
        Umbral: {value ?? 'sin definir'}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" min="0" step="any" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
        className="w-16 bg-slate-700 text-white text-[10px] rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      <button type="button" onClick={save} disabled={saving} className="text-[10px] text-brand-400 font-semibold">✓</button>
      <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-slate-500">✕</button>
    </span>
  )
}

function ComentarioEditor({ materialId, value, onSaved }: { materialId: string; value: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateMaterialComentario(materialId, draft)
      setEditing(false)
      onSaved()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(value ?? ''); setEditing(true) }}
        className="text-[10px] text-slate-500 hover:text-brand-400 underline decoration-dotted text-left truncate max-w-full">
        {value?.trim() || 'sin comentario'}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 w-full">
      <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
        placeholder="Comentario…"
        className="w-32 bg-slate-700 text-white text-[10px] rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      <button type="button" onClick={save} disabled={saving} className="text-[10px] text-brand-400 font-semibold shrink-0">✓</button>
      <button type="button" onClick={() => setEditing(false)} className="text-[10px] text-slate-500 shrink-0">✕</button>
    </span>
  )
}

function ProyectoTab() {
  const [proyectos, setProyectos] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState('')

  useEffect(() => {
    adminRepo.listActiveProjects()
      .then((ps) => { setProyectos(ps); if (ps.length > 0) setProjectId(ps[0].id) })
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-3">
      {proyectos.length === 0 ? (
        <p className="text-xs text-slate-500">No hay proyectos activos.</p>
      ) : (
        <>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputCls} w-full`}>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.area === 'ATT' ? 'ATT' : 'Preventivo'}] {p.ott || 'Sin código'}
              </option>
            ))}
          </select>
          {projectId && <ResumenProyectoTable projectId={projectId} area={proyectos.find((p) => p.id === projectId)?.area ?? 'ATT'} />}
        </>
      )}
    </div>
  )
}

type TecColKey = 'sku' | 'material' | 'lote' | 'proyecto' | 'entregado' | 'instalado' | 'devuelto' | 'rebajado' | 'merma' | 'transito'

const TEC_COLUMNS: { key: TecColKey; label: string; numeric?: boolean; align?: 'right' }[] = [
  { key: 'sku', label: 'SKU', numeric: true },
  { key: 'material', label: 'Material' },
  { key: 'lote', label: 'Lote' },
  { key: 'proyecto', label: 'Proyecto' },
  { key: 'entregado', label: 'Entregado', numeric: true, align: 'right' },
  { key: 'instalado', label: 'Instalado', numeric: true, align: 'right' },
  { key: 'devuelto', label: 'Devuelto', numeric: true, align: 'right' },
  { key: 'rebajado', label: 'Rebajado', numeric: true, align: 'right' },
  { key: 'merma', label: 'Merma', numeric: true, align: 'right' },
  { key: 'transito', label: 'Tránsito', numeric: true, align: 'right' },
]

const SIN_PROYECTO_TEC = '🅿️ Sin proyecto'

function tecColValue(r: TecnicoLedgerRow, key: TecColKey): string | number {
  switch (key) {
    case 'sku': return r.materialSku
    case 'material': return r.materialDescripcion
    case 'lote': return r.lote
    case 'proyecto': return r.projectOtt ?? ''
    case 'entregado': return r.cantEntregada
    case 'instalado': return r.cantInstalada
    case 'devuelto': return r.cantDevuelta
    case 'rebajado': return r.cantRebajada
    case 'merma': return r.cantMerma
    case 'transito': return r.cantTransito
  }
}

/** Igual que en Bodega/Movimientos: texto para el checklist de filtro. */
function tecColDisplayValue(r: TecnicoLedgerRow, key: TecColKey): string {
  if (key === 'proyecto') {
    return r.projectOtt ? `[${r.projectArea === 'ATT' ? 'ATT' : 'Preventivo'}] ${r.projectOtt}` : SIN_PROYECTO_TEC
  }
  return String(tecColValue(r, key))
}

const TEC_NUMERIC_COLS: TecColKey[] = ['entregado', 'instalado', 'devuelto', 'rebajado', 'merma', 'transito']

function sortTecColumnValues(key: TecColKey, values: string[]): string[] {
  if (key === 'sku') return [...values].sort((a, b) => compareSku(a, b, 'asc'))
  if (TEC_NUMERIC_COLS.includes(key)) return [...values].sort((a, b) => Number(a) - Number(b))
  return [...values].sort((a, b) => a.localeCompare(b))
}

function TecnicoTab() {
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [userId, setUserId] = useState('')
  const [rows, setRows] = useState<TecnicoLedgerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Eventos de instalación forzada (stock negativo) de CUALQUIER técnico —
  // no depende de cuál esté elegido en el selector de abajo. Separados de
  // los de Conteo (origen bodega), que se resuelven en esa otra pestaña.
  const [eventos, setEventos] = useState<EventoInventario[] | null>(null)

  async function reloadEventos() {
    try {
      const evs = await listEventosInventario({ estado: 'abierto' })
      setEventos(evs.filter((e) => e.ubicacionTipo === 'tecnico'))
    } catch (err) {
      console.error('[TecnicoTab] listEventosInventario:', err)
    }
  }
  useEffect(() => { reloadEventos() }, [])

  // Mismo patrón que Bodega/Movimientos: orden (por defecto, el que ya trae
  // getTecnicoLedger — por OTT) reemplazado por un clic en una columna;
  // filtro tipo Google Sheets por columna.
  const [sort, setSort] = useState<{ key: TecColKey; dir: 'asc' | 'desc' } | null>(null)
  const [colSelected, setColSelected] = useState<Partial<Record<TecColKey, Set<string>>>>({})
  const [openMenu, setOpenMenu] = useState<TecColKey | null>(null)

  useEffect(() => {
    adminRepo.listProfiles()
      .then((all) => {
        const cs = all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log'))
        setTecnicos(cs)
        if (cs.length > 0) setUserId(cs[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!userId) return
    setRows(null)
    setColSelected({})
    setSort(null)
    getTecnicoLedger(userId).then(setRows).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [userId])

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<TecColKey, string[]>
    for (const col of TEC_COLUMNS) {
      result[col.key] = sortTecColumnValues(col.key, [...new Set((rows ?? []).map((r) => tecColDisplayValue(r, col.key)))])
    }
    return result
  }, [rows])

  const displayRows = useMemo(() => {
    if (!rows) return null
    let out = rows
    for (const key of Object.keys(colSelected) as TecColKey[]) {
      const set = colSelected[key]
      if (!set) continue
      out = out.filter((r) => set.has(tecColDisplayValue(r, key)))
    }
    if (!sort) return out
    const sorted = [...out]
    sorted.sort((a, b) => {
      if (sort.key === 'sku') return compareSku(a.materialSku, b.materialSku, sort.dir)
      const va = tecColValue(a, sort.key)
      const vb = tecColValue(b, sort.key)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [rows, colSelected, sort])

  return (
    <div className="space-y-3">
      {eventos && eventos.length > 0 && (
        <EventosAbiertosSection eventos={eventos} onResolved={reloadEventos} />
      )}

      {tecnicos.length === 0 ? (
        <p className="text-xs text-slate-500">No hay técnicos ni logística registrados.</p>
      ) : (
        <>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${inputCls} w-full`}>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre?.trim() || t.email}</option>)}
          </select>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {displayRows === null ? (
            <p className="text-xs text-slate-500">Cargando…</p>
          ) : rows && rows.length === 0 ? (
            <p className="text-xs text-slate-500">Sin material entregado.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                    {TEC_COLUMNS.map((col) => {
                      const colValues = valuesByColumn[col.key]
                      const colSelectedSet = colSelected[col.key]
                      return (
                        <ColumnHeader key={col.key} col={col}
                          sort={sort} onSort={(dir) => { setSort(dir ? { key: col.key, dir } : null); setOpenMenu(null) }}
                          checklist={{
                            values: colValues,
                            selected: colSelectedSet ?? null,
                            onToggleValue: (v) => setColSelected((prev) => {
                              const current = new Set(prev[col.key] ?? colValues)
                              if (current.has(v)) current.delete(v); else current.add(v)
                              const next = { ...prev }
                              if (current.size === colValues.length) delete next[col.key]
                              else next[col.key] = current
                              return next
                            }),
                            onSelectAll: () => setColSelected((prev) => {
                              const next = { ...prev }
                              delete next[col.key]
                              return next
                            }),
                            onSelectNone: () => setColSelected((prev) => ({ ...prev, [col.key]: new Set() })),
                          }}
                          open={openMenu === col.key} onToggle={() => setOpenMenu((k) => (k === col.key ? null : col.key))} />
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 && (
                    <tr><td colSpan={TEC_COLUMNS.length} className="px-2 py-3 text-center text-slate-500">
                      Ningún resultado con los filtros de columna actuales.
                    </td></tr>
                  )}
                  {displayRows.map((r) => (
                    <tr key={`${r.projectId ?? ''}|${r.materialId}|${r.lote}`}
                      className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.materialSku}</td>
                      <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{r.materialDescripcion}</p></td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.lote}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                        {r.projectOtt ? `[${r.projectArea === 'ATT' ? 'ATT' : 'Preventivo'}] ${r.projectOtt}` : SIN_PROYECTO_TEC}
                      </td>
                      <td className="px-2 py-2 text-right text-white whitespace-nowrap">{r.cantEntregada}</td>
                      <td className="px-2 py-2 text-right text-white whitespace-nowrap">{r.cantInstalada}</td>
                      <td className="px-2 py-2 text-right text-white whitespace-nowrap">{r.cantDevuelta}</td>
                      <td className="px-2 py-2 text-right text-white whitespace-nowrap">{r.cantRebajada}</td>
                      <td className={`px-2 py-2 text-right font-semibold whitespace-nowrap ${r.cantTransito > 0 ? 'text-amber-400' : 'text-white'}`}>
                        {r.cantTransito}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ConteoTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  if (selectedId) {
    return <ConteoDetail conteoId={selectedId} onBack={() => { setSelectedId(null); setRefreshKey((k) => k + 1) }} />
  }
  return <ConteoLista onSelect={setSelectedId} refreshKey={refreshKey} />
}

function ConteoLista({ onSelect, refreshKey }: { onSelect: (id: string) => void; refreshKey: number }) {
  const [conteos, setConteos] = useState<Conteo[] | null>(null)
  const [eventos, setEventos] = useState<EventoInventario[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNuevo, setShowNuevo] = useState(false)

  async function reload() {
    try {
      const [cs, evs] = await Promise.all([listConteos(), listEventosInventario({ estado: 'abierto' })])
      setConteos(cs)
      // Los de técnico (instalación forzada) se resuelven en la pestaña
      // Técnico — acá solo quedan los de origen bodega (Conteo).
      setEventos(evs.filter((e) => e.ubicacionTipo !== 'tecnico'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey])

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {eventos && eventos.length > 0 && <EventosAbiertosSection eventos={eventos} onVerConteo={onSelect} onResolved={reload} />}

      <button type="button" onClick={() => setShowNuevo((v) => !v)}
        className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white">
        {showNuevo ? 'Cancelar' : '+ Nuevo conteo'}
      </button>
      {showNuevo && <NuevoConteoForm onCreated={(id) => { setShowNuevo(false); onSelect(id) }} />}

      {conteos === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : conteos.length === 0 ? (
        <p className="text-xs text-slate-500">Sin conteos todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {conteos.map((c) => (
            <button key={c.id} type="button" onClick={() => onSelect(c.id)}
              className="w-full text-left bg-slate-800 rounded-xl border border-slate-700 hover:border-brand-500 transition-colors p-3 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{c.ubicacionNombre} · {c.naturaleza === 'fisico' ? 'Físico' : 'Digital'}</p>
                <p className="text-slate-500">
                  {new Date(c.fecha).toLocaleDateString('es-CL', { timeZone: 'UTC' })}{c.nota ? ` · ${c.nota}` : ''}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${c.estado === 'abierto' ? 'bg-amber-900/60 text-amber-300' : 'bg-slate-700 text-slate-400'}`}>
                {c.estado === 'abierto' ? 'Abierto' : 'Cerrado'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NuevoConteoForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [ubicacionId, setUbicacionId] = useState('')
  const [naturaleza, setNaturaleza] = useState<'fisico' | 'digital'>('fisico')
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!ubicacionId) { setError('Elige una ubicación'); return }
    setBusy(true)
    setError(null)
    try {
      const id = await abrirConteo({ ubicacionId, naturaleza, nota: nota.trim() || undefined })
      onCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <UbicacionSelect value={ubicacionId} onChange={setUbicacionId} className={`${inputCls} w-full`} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setNaturaleza('fisico')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${naturaleza === 'fisico' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
          Físico
        </button>
        <button type="button" onClick={() => setNaturaleza('digital')}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${naturaleza === 'digital' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
          Digital
        </button>
      </div>
      <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" className={`${inputCls} w-full`} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="button" onClick={submit} disabled={busy}
        className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
        {busy ? 'Abriendo…' : 'Abrir conteo'}
      </button>
    </div>
  )
}

const AREA_LABELS: Record<ConsumoArea, string> = {
  ott: 'ATT (OTT)', inc: 'Incidencia', preventivos: 'Preventivo', perdida: 'Pérdida',
}
const TIPO_RESOLUCION_LABELS: Record<ResolucionTipo, string> = {
  consumo: 'Consumo', devolucion: 'Devolución', traspaso: 'Traspaso', reasignacion: 'Reasignar a técnico',
  agregar: 'Agregar',
}

/**
 * Solo lectura — resumen de eventos pendientes. Se usa en dos lugares, cada
 * uno con solo su tipo de evento (separados para que cada uno se resuelva
 * en su propia pestaña): Conteo (origen bodega, con botón a su conteo) y
 * Técnico (origen instalación forzada, sin conteo asociado — `onVerConteo`
 * no aplica ahí).
 */
function EventosAbiertosSection({ eventos, onVerConteo, onResolved }: {
  eventos: EventoInventario[]; onVerConteo?: (conteoId: string) => void; onResolved: () => void
}) {
  return (
    <div className="bg-amber-950/40 border border-amber-700/50 rounded-2xl p-4 space-y-2">
      <p className="text-sm font-semibold text-amber-300">⚠️ {eventos.length} diferencia(s) por resolver</p>
      <div className="space-y-1.5">
        {eventos.map((e) => (
          <EventoCard key={e.id} evento={e} onResolved={onResolved} onVerConteo={onVerConteo} mostrarUbicacion />
        ))}
      </div>
    </div>
  )
}

function ConteoDetail({ conteoId, onBack }: { conteoId: string; onBack: () => void }) {
  const [conteo, setConteo] = useState<Conteo | null>(null)
  const [lineas, setLineas] = useState<ConteoLinea[] | null>(null)
  const [eventos, setEventos] = useState<EventoInventario[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  async function reload() {
    try {
      const [cs, ls, evs] = await Promise.all([listConteos(), getConteoLineas(conteoId), listEventosPorConteo(conteoId)])
      setConteo(cs.find((c) => c.id === conteoId) ?? null)
      setLineas(ls)
      setEventos(evs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conteoId])

  // Ediciones aún no persistidas (por línea) o una importación en curso: el
  // cierre queda bloqueado mientras haya alguna, para que un "Cerrar conteo"
  // inmediato no le gane la carrera al guardado async.
  const [lineasPendientes, setLineasPendientes] = useState<Record<string, boolean>>({})
  const [importando, setImportando] = useState(false)
  const hayPendientes = importando || Object.values(lineasPendientes).some(Boolean)
  function marcarPendiente(lineaId: string, pendiente: boolean) {
    setLineasPendientes((prev) => (prev[lineaId] === pendiente ? prev : { ...prev, [lineaId]: pendiente }))
  }

  async function cerrar() {
    if (!confirm('¿Cerrar este conteo? Se ajustará el stock según lo contado y se abrirá un evento por cada diferencia.')) return
    setClosing(true)
    setError(null)
    try {
      await cerrarConteo(conteoId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setClosing(false)
    }
  }

  async function descartar() {
    if (!confirm('¿Descartar este conteo? No se aplicará ningún ajuste de stock y no se puede deshacer.')) return
    setDiscarding(true)
    setError(null)
    try {
      await descartarConteo(conteoId)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscarding(false)
    }
  }

  const abierto = conteo?.estado === 'abierto'

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-white">← Volver a conteos</button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!conteo || !lineas ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4">
            <p className="text-sm font-semibold text-white">{conteo.ubicacionNombre} · {conteo.naturaleza === 'fisico' ? 'Físico' : 'Digital'}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {new Date(conteo.fecha).toLocaleDateString('es-CL', { timeZone: 'UTC' })}{conteo.nota ? ` · ${conteo.nota}` : ''}
            </p>
          </div>

          {eventos && eventos.length > 0 && <EventosDelConteoSection eventos={eventos} onResolved={reload} />}

          <ConteoLineasTabla lineas={lineas} editable={abierto} onSaved={reload}
            onPendienteChange={marcarPendiente} />

          {abierto && (
            <ImportarSapSection conteoId={conteoId} onImported={reload} onImportingChange={setImportando} />
          )}

          {abierto && <AgregarLineaForm conteoId={conteoId} onAdded={reload} />}

          {abierto ? (
            <>
              {hayPendientes && (
                <p className="text-[11px] text-amber-400 text-center">Hay cantidades sin guardar — toca ✓ junto al campo para guardarlas.</p>
              )}
              <button type="button" onClick={cerrar} disabled={closing || discarding || hayPendientes}
                className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
                {closing ? 'Cerrando…' : 'Cerrar conteo'}
              </button>
              <button type="button" onClick={descartar} disabled={closing || discarding}
                className="w-full text-xs font-semibold py-1.5 rounded-xl border border-red-800 text-red-400 hover:bg-red-950/40 disabled:opacity-40">
                {discarding ? 'Descartando…' : 'Descartar conteo'}
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-500 text-center">Conteo cerrado — el stock ya quedó ajustado.</p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Eventos del conteo (abiertos y resueltos) — se muestran arriba de la tabla.
// ---------------------------------------------------------------------------

function EventosDelConteoSection({ eventos, onResolved }: { eventos: EventoInventario[]; onResolved: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-white">Eventos de este conteo</p>
      {eventos.map((e) => <EventoCard key={e.id} evento={e} onResolved={onResolved} />)}
    </div>
  )
}

/** /att/:id, /preventivos/:id o /incidencias/:id según el área/subárea real del proyecto. */
function rutaProyecto(area: 'ATT' | 'OyM', subarea: 'preventivo' | 'incidencia' | null, projectId: string): string {
  if (area === 'ATT') return `/att/${projectId}`
  return subarea === 'incidencia' ? `/incidencias/${projectId}` : `/preventivos/${projectId}`
}

function EventoCard({ evento, onResolved, onVerConteo, mostrarUbicacion }: {
  evento: EventoInventario; onResolved: () => void
  /** Solo la tiene sentido en la lista general (varios conteos mezclados) — dentro de un conteo ya se sabe cuál es. */
  onVerConteo?: (conteoId: string) => void
  mostrarUbicacion?: boolean
}) {
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const restante = Math.abs(evento.diferencia) - evento.cantidadResuelta
  const resuelto = evento.estado === 'resuelto'

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-white truncate">{evento.materialSku} — {evento.materialDescripcion}</p>
          <p className="text-slate-500">
            {mostrarUbicacion && `${evento.ubicacionNombre} · `}
            lote {evento.lote} · {new Date(evento.createdAt).toLocaleDateString('es-CL', { timeZone: 'UTC' })} ·{' '}
            <span className={evento.diferencia < 0 ? 'text-red-400' : 'text-amber-400'}>
              {evento.diferencia > 0 ? '+' : ''}{evento.diferencia}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onVerConteo && evento.conteoId && (
            <button type="button" onClick={() => onVerConteo(evento.conteoId!)} className="text-xs text-amber-400 font-semibold hover:text-amber-300">
              Ver conteo →
            </button>
          )}
          {evento.origenMovimiento?.projectId && evento.origenMovimiento.projectArea && (
            <button type="button"
              onClick={() => navigate(rutaProyecto(evento.origenMovimiento!.projectArea!, evento.origenMovimiento!.projectSubarea, evento.origenMovimiento!.projectId!))}
              className="text-xs text-amber-400 font-semibold hover:text-amber-300">
              Ver proyecto →
            </button>
          )}
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
            resuelto ? 'bg-slate-700 text-slate-400' : evento.cantidadResuelta > 0 ? 'bg-blue-900/50 text-blue-300' : 'bg-amber-900/60 text-amber-300'
          }`}>
            {resuelto ? 'Resuelto' : evento.cantidadResuelta > 0 ? `Parcial (${evento.cantidadResuelta}/${Math.abs(evento.diferencia)})` : 'Pendiente'}
          </span>
        </div>
      </div>

      {!evento.conteoId && (
        <p className="text-[10px] text-slate-500 italic">
          Instalación forzada sin stock suficiente — a nombre de {evento.ubicacionNombre}.
          {evento.origenMovimiento && (
            <> Consumo simultáneo: {evento.origenMovimiento.cantidad} unidad(es) el {new Date(evento.origenMovimiento.fecha).toLocaleString('es-CL', { timeZone: 'UTC' })}
              {evento.origenMovimiento.projectOtt && ` · proyecto ${evento.origenMovimiento.projectOtt}`}
              {evento.origenMovimiento.tecnicoNombre && ` · ${evento.origenMovimiento.tecnicoNombre}`}.</>
          )}
        </p>
      )}

      {evento.resoluciones.length > 0 && (
        <div className="border-t border-slate-700 pt-2 space-y-1">
          {evento.resoluciones.map((r) => <ResolucionRow key={r.id} r={r} />)}
        </div>
      )}

      {!resuelto && (
        showForm ? (
          <ResolverEventoForm evento={evento} restante={restante}
            onDone={() => { setShowForm(false); onResolved() }} onCancel={() => setShowForm(false)} />
        ) : (
          <button type="button" onClick={() => setShowForm(true)} className="text-xs text-amber-400 font-semibold">
            Resolver{evento.cantidadResuelta > 0 ? ` (quedan ${restante})` : ''} →
          </button>
        )
      )}
    </div>
  )
}

function ResolucionRow({ r }: { r: EventoResolucion }) {
  const detalle = r.tipo === 'consumo'
    ? (r.area === 'perdida' ? 'Pérdida' : `${AREA_LABELS[r.area ?? 'perdida']} · ${r.projectOtt ?? '—'}${r.tecnicoNombre ? ` · ${r.tecnicoNombre}` : ''}`)
    : r.tipo === 'agregar'
    ? 'Sumado directo (sin origen) — ya lo tenía sin contabilizar'
    : (r.tecnicoNombre ? `Técnico: ${r.tecnicoNombre}` : `Bodega: ${r.ubicacionNombre}`)
  return (
    <p className="text-[11px] text-slate-400">
      <span className="text-slate-300 font-medium">{TIPO_RESOLUCION_LABELS[r.tipo]}</span> · {r.cantidad} · {detalle}
      {r.nota && <span className="italic"> — {r.nota}</span>}
    </p>
  )
}

function ResolverEventoForm({ evento, restante, onDone, onCancel }: {
  evento: EventoInventario; restante: number; onDone: () => void; onCancel: () => void
}) {
  // De técnico (instalación forzada): Consumo/Devolución/Reasignación/Agregar,
  // nunca Traspaso (el material ya se instaló, no está "por encontrar" en
  // otro lado). De bodega (conteo): igual que siempre, según el signo de la
  // diferencia (Agregar no aplica ahí — ver 0042_agregar_stock_tecnico.sql).
  const tiposDisponibles: ResolucionTipo[] = evento.ubicacionTipo === 'tecnico'
    ? ['consumo', 'devolucion', 'reasignacion', 'agregar']
    : (evento.diferencia < 0 ? ['consumo', 'traspaso'] : ['devolucion'])
  const [tipo, setTipo] = useState<ResolucionTipo>(tiposDisponibles[0])
  const [cantidad, setCantidad] = useState(String(restante))
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Consumo — si el evento ya tiene un movimiento real asociado (instalación
  // forzada), ese proyecto ya quedó acreditado: solo cabe "Pérdida" acá, para
  // no duplicar el instalado en Logística/KPI.
  const soloPerdida = evento.movimientoId !== null
  const [area, setArea] = useState<ConsumoArea>('perdida')
  const [projectId, setProjectId] = useState('')
  const [proyectos, setProyectos] = useState<ProjectSummary[]>([])
  // Devolución/Traspaso: origen o destino. Consumo: técnico opcional (quién lo usó, si se sabe).
  const [modo, setModo] = useState<'tecnico' | 'bodega'>('tecnico')
  const [tecnicoId, setTecnicoId] = useState('')
  const [ubicacionId, setUbicacionId] = useState('')
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  // Reasignación: solo técnicos del mismo proyecto que causó la instalación.
  const [miembrosProyecto, setMiembrosProyecto] = useState<MemberProfile[]>([])
  const [tecnicoReasignarId, setTecnicoReasignarId] = useState('')

  useEffect(() => {
    adminRepo.listActiveProjects().then(setProyectos).catch(() => {})
    adminRepo.listProfiles().then((all) => setTecnicos(all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log')))).catch(() => {})
    listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {})
    if (evento.origenMovimiento?.projectId) {
      adminRepo.listMembers(evento.origenMovimiento.projectId).then(setMiembrosProyecto).catch(() => {})
    }
  }, [evento.origenMovimiento?.projectId])

  const proyectosFiltrados = useMemo(() => {
    if (area === 'ott') return proyectos.filter((p) => p.area === 'ATT')
    if (area === 'inc') return proyectos.filter((p) => p.area === 'OyM' && p.subarea === 'incidencia')
    if (area === 'preventivos') return proyectos.filter((p) => p.area === 'OyM' && p.subarea === 'preventivo')
    return []
  }, [area, proyectos])

  const bodegasFiltradas = useMemo(() => bodegas.filter((b) => b.id !== evento.ubicacionId), [bodegas, evento.ubicacionId])
  // Nunca ofrecer al mismo técnico que ya tiene el evento como origen/destino/reasignación.
  const tecnicosFiltrados = useMemo(() => tecnicos.filter((t) => t.id !== evento.origenMovimiento?.tecnicoUserId), [tecnicos, evento.origenMovimiento])
  const miembrosFiltrados = useMemo(() => miembrosProyecto.filter((m) => m.id !== evento.origenMovimiento?.tecnicoUserId), [miembrosProyecto, evento.origenMovimiento])

  async function submit() {
    const n = Number(cantidad)
    if (!cantidad || !(n > 0) || n > restante) { setError(`Cantidad inválida (máximo ${restante})`); return }
    if (tipo === 'consumo' && !soloPerdida && area !== 'perdida' && !projectId) { setError('Falta elegir el proyecto'); return }
    if ((tipo === 'devolucion' || tipo === 'traspaso') && modo === 'tecnico' && !tecnicoId) { setError('Falta elegir el técnico'); return }
    if ((tipo === 'devolucion' || tipo === 'traspaso') && modo === 'bodega' && !ubicacionId) { setError('Falta elegir la bodega'); return }
    if (tipo === 'reasignacion' && !tecnicoReasignarId) { setError('Falta elegir el técnico correcto'); return }

    setBusy(true)
    setError(null)
    try {
      await resolverEvento(evento.id, {
        tipo, cantidad: n, nota: nota.trim() || undefined,
        area: tipo === 'consumo' ? (soloPerdida ? 'perdida' : area) : undefined,
        projectId: tipo === 'consumo' && !soloPerdida && area !== 'perdida' ? projectId : undefined,
        tecnicoUserId: tipo === 'consumo' ? (tecnicoId || undefined)
          : tipo === 'reasignacion' ? tecnicoReasignarId
          : tipo === 'agregar' ? undefined
          : modo === 'tecnico' ? tecnicoId : undefined,
        ubicacionId: (tipo === 'devolucion' || tipo === 'traspaso') && modo === 'bodega' ? ubicacionId : undefined,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const selectCls = 'w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'

  return (
    <div className="bg-slate-700/50 rounded-xl p-3 space-y-2">
      <div className="flex gap-1.5">
        {tiposDisponibles.map((t) => (
          <button key={t} type="button" onClick={() => setTipo(t)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${tipo === t ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            {TIPO_RESOLUCION_LABELS[t]}
          </button>
        ))}
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-slate-400">Cantidad (máx. {restante})</span>
        <input type="number" min="0" max={restante} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
          className={selectCls} />
      </label>

      {tipo === 'consumo' && (
        soloPerdida ? (
          <p className="text-[11px] text-slate-400 italic">
            Solo Pérdida — el proyecto de esta instalación ya quedó acreditado como instalado, no se puede elegir otro sin duplicarlo.
          </p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-400">Área</span>
              <select value={area} onChange={(e) => { setArea(e.target.value as ConsumoArea); setProjectId('') }} className={selectCls}>
                <option value="perdida">Pérdida</option>
                <option value="ott">ATT (OTT)</option>
                <option value="inc">Incidencia</option>
                <option value="preventivos">Preventivo</option>
              </select>
            </label>
            {area !== 'perdida' && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">Proyecto</span>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={selectCls}>
                    <option value="">Elegir proyecto…</option>
                    {proyectosFiltrados.map((p) => (
                      <option key={p.id} value={p.id}>{p.ott || 'Sin código'}{p.nombreProyecto ? ` — ${p.nombreProyecto}` : ''}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">Técnico (opcional)</span>
                  <select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} className={selectCls}>
                    <option value="">Sin especificar…</option>
                    {tecnicosFiltrados.map((t) => <option key={t.id} value={t.id}>{t.nombre?.trim() || t.email}</option>)}
                  </select>
                </label>
              </>
            )}
          </>
        )
      )}

      {(tipo === 'devolucion' || tipo === 'traspaso') && (
        <>
          <div className="flex gap-2">
            <button type="button" onClick={() => setModo('tecnico')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${modo === 'tecnico' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Técnico
            </button>
            <button type="button" onClick={() => setModo('bodega')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${modo === 'bodega' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Bodega
            </button>
          </div>
          {modo === 'tecnico' ? (
            <select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} className={selectCls}>
              <option value="">Elegir técnico…</option>
              {tecnicosFiltrados.map((t) => <option key={t.id} value={t.id}>{t.nombre?.trim() || t.email}</option>)}
            </select>
          ) : (
            <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)} className={selectCls}>
              <option value="">Elegir bodega…</option>
              {bodegasFiltradas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          )}
        </>
      )}

      {tipo === 'reasignacion' && (
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Técnico correcto (debe ser parte del proyecto y tener stock suficiente)</span>
          <select value={tecnicoReasignarId} onChange={(e) => setTecnicoReasignarId(e.target.value)} className={selectCls}>
            <option value="">Elegir técnico…</option>
            {miembrosFiltrados.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
          </select>
          {miembrosFiltrados.length === 0 && (
            <p className="text-[11px] text-amber-400">
              No hay otro técnico asignado a este proyecto — si falta agregar al correcto, hazlo primero en Logística → Técnicos asignados.
            </p>
          )}
        </label>
      )}

      {tipo === 'agregar' && (
        <p className="text-[11px] text-slate-400 italic">
          Se le suma directo al técnico — no se resta de ninguna bodega ni de otro técnico. Usar solo si ya tenía este material físicamente antes, sin contabilizar.
        </p>
      )}

      <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" className={selectCls} />

      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
          {busy ? 'Guardando…' : 'Confirmar'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-400 px-2">Cancelar</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabla de líneas del conteo (solo en el detalle de un conteo — mismo patrón
// ColumnHeader que Bodega/KPI) con "Contado" editable mientras esté abierto.
// ---------------------------------------------------------------------------

type ConteoColKey = 'sku' | 'material' | 'lote' | 'sistema' | 'contado' | 'diferencia'

const CONTEO_COLUMNS: { key: ConteoColKey; label: string; numeric?: boolean; align?: 'right' }[] = [
  { key: 'sku', label: 'SKU', numeric: true },
  { key: 'material', label: 'Material' },
  { key: 'lote', label: 'Lote' },
  { key: 'sistema', label: 'Sistema', numeric: true, align: 'right' },
  { key: 'contado', label: 'Contado', numeric: true, align: 'right' },
  { key: 'diferencia', label: 'Diferencia', numeric: true, align: 'right' },
]

function conteoColValue(l: ConteoLinea, key: ConteoColKey): string | number {
  switch (key) {
    case 'sku': return l.materialSku
    case 'material': return l.materialDescripcion
    case 'lote': return l.lote
    case 'sistema': return l.cantidadSistema
    case 'contado': return l.cantidadContada
    case 'diferencia': return l.primeraVez ? 0 : l.cantidadContada - l.cantidadSistema
  }
}

function sortConteoColumnValues(key: ConteoColKey, values: string[]): string[] {
  if (key === 'sku') return [...values].sort((a, b) => compareSku(a, b, 'asc'))
  if (key === 'sistema' || key === 'contado' || key === 'diferencia') return [...values].sort((a, b) => Number(a) - Number(b))
  return [...values].sort((a, b) => a.localeCompare(b))
}

function ConteoLineasTabla({ lineas, editable, onSaved, onPendienteChange }: {
  lineas: ConteoLinea[] | null; editable: boolean; onSaved: () => void; onPendienteChange: (lineaId: string, pendiente: boolean) => void
}) {
  const [sort, setSort] = useState<{ key: ConteoColKey; dir: 'asc' | 'desc' } | null>(null)
  const [colSelected, setColSelected] = useState<Partial<Record<ConteoColKey, Set<string>>>>({})
  const [openMenu, setOpenMenu] = useState<ConteoColKey | null>(null)

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<ConteoColKey, string[]>
    for (const col of CONTEO_COLUMNS) {
      result[col.key] = sortConteoColumnValues(col.key, [...new Set((lineas ?? []).map((l) => String(conteoColValue(l, col.key))))])
    }
    return result
  }, [lineas])

  const displayLineas = useMemo(() => {
    if (!lineas) return null
    let out = lineas
    for (const key of Object.keys(colSelected) as ConteoColKey[]) {
      const set = colSelected[key]
      if (!set) continue
      out = out.filter((l) => set.has(String(conteoColValue(l, key))))
    }
    const sorted = [...out]
    if (sort) {
      sorted.sort((a, b) => {
        if (sort.key === 'sku') return compareSku(a.materialSku, b.materialSku, sort.dir)
        const va = conteoColValue(a, sort.key)
        const vb = conteoColValue(b, sort.key)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sort.dir === 'asc' ? cmp : -cmp
      })
    } else {
      sorted.sort((a, b) => compareSku(a.materialSku, b.materialSku, 'asc') || a.lote.localeCompare(b.lote))
    }
    return sorted
  }, [lineas, colSelected, sort])

  if (!lineas) return <p className="text-xs text-slate-500">Cargando…</p>
  if (lineas.length === 0) return <p className="text-xs text-slate-500">Sin líneas — el sistema no tenía stock en esta ubicación.</p>

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-slate-800 text-slate-400 text-left divide-x divide-slate-700">
            {CONTEO_COLUMNS.map((col) => (
              <ColumnHeader key={col.key} col={col}
                sort={sort} onSort={(dir) => { setSort(dir ? { key: col.key, dir } : null); setOpenMenu(null) }}
                checklist={{
                  values: valuesByColumn[col.key],
                  selected: colSelected[col.key] ?? null,
                  onToggleValue: (v) => setColSelected((prev) => {
                    const current = new Set(prev[col.key] ?? valuesByColumn[col.key])
                    if (current.has(v)) current.delete(v); else current.add(v)
                    const next = { ...prev }
                    if (current.size === valuesByColumn[col.key].length) delete next[col.key]
                    else next[col.key] = current
                    return next
                  }),
                  onSelectAll: () => setColSelected((prev) => { const next = { ...prev }; delete next[col.key]; return next }),
                  onSelectNone: () => setColSelected((prev) => ({ ...prev, [col.key]: new Set() })),
                }}
                open={openMenu === col.key} onToggle={() => setOpenMenu((k) => (k === col.key ? null : col.key))} />
            ))}
          </tr>
        </thead>
        <tbody>
          {displayLineas?.length === 0 && (
            <tr><td colSpan={CONTEO_COLUMNS.length} className="px-2 py-3 text-center text-slate-500">
              Ningún resultado con los filtros de columna actuales.
            </td></tr>
          )}
          {displayLineas?.map((l) => (
            <ConteoLineaFila key={l.id} linea={l} editable={editable} onSaved={onSaved}
              onPendienteChange={(pendiente) => onPendienteChange(l.id, pendiente)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConteoLineaFila({ linea, editable, onSaved, onPendienteChange }: {
  linea: ConteoLinea; editable: boolean; onSaved: () => void; onPendienteChange: (pendiente: boolean) => void
}) {
  const [draft, setDraft] = useState(String(linea.cantidadContada))
  const [saving, setSaving] = useState(false)
  // Cerrado: la diferencia sale de lo persistido, no del draft local (que
  // puede quedar obsoleto si el guardado nunca ocurrió).
  const diferencia = (editable ? Number(draft || 0) : linea.cantidadContada) - linea.cantidadSistema
  const dirty = editable && draft.trim() !== '' && Number(draft) !== linea.cantidadContada

  useEffect(() => { onPendienteChange(dirty || saving) }, [dirty, saving, onPendienteChange])

  async function save() {
    const n = Number(draft)
    if (draft.trim() === '' || Number.isNaN(n) || n === linea.cantidadContada) return
    setSaving(true)
    try {
      await actualizarLineaConteo(linea.id, n)
      onSaved()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{linea.materialSku}</td>
      <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{linea.materialDescripcion}</p></td>
      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{linea.lote}</td>
      <td className="px-2 py-2 text-right text-slate-300 whitespace-nowrap">
        {linea.primeraVez ? <span className="text-[10px] text-slate-500">primer conteo</span> : linea.cantidadSistema}
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap">
        {editable ? (
          <div className="flex items-center justify-end gap-1.5">
            <input type="number" step="any" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={saving}
              className={`w-20 bg-slate-700 text-white text-sm rounded-lg px-2 py-1 border text-right focus:outline-none ${
                dirty ? 'border-amber-500' : 'border-slate-600 focus:border-brand-500'
              }`} />
            {/* Botón explícito: en varios celulares el teclado numérico no deja "tocar
                fuera del campo" para disparar el blur (o el teclado tapa toda la
                pantalla) — sin esto, el cambio quedaba solo en el draft local y nunca
                se guardaba. */}
            <button type="button" onClick={save} disabled={!dirty || saving}
              title="Guardar" aria-label="Guardar"
              className="text-sm w-7 h-7 rounded-lg bg-slate-700 border border-slate-600 disabled:opacity-30 text-green-400 hover:bg-slate-600 disabled:hover:bg-slate-700 shrink-0">
              {saving ? '⏳' : '✓'}
            </button>
          </div>
        ) : (
          <span className="text-white font-semibold">{linea.cantidadContada}</span>
        )}
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap">
        {!linea.primeraVez && diferencia !== 0 && (
          <span className={`text-[10px] font-semibold ${diferencia < 0 ? 'text-red-400' : 'text-amber-400'}`}>
            {diferencia > 0 ? '+' : ''}{diferencia}
          </span>
        )}
      </td>
    </tr>
  )
}

function ImportarSapSection({ conteoId, onImported, onImportingChange }: {
  conteoId: string; onImported: () => void; onImportingChange: (importando: boolean) => void
}) {
  const [modoPegar, setModoPegar] = useState(false)
  const [pegado, setPegado] = useState('')
  const [filas, setFilas] = useState<FilaImportSap[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fase, setFase] = useState<'materiales' | 'lineas' | null>(null)
  const [resultado, setResultado] = useState<ImportarSapResultado | null>(null)

  function limpiarPreview() {
    setFilas(null)
    setModoPegar(false)
    setPegado('')
    setParseError(null)
  }

  async function processXlsxFile(file: File) {
    setResultado(null)
    setParseError(null)
    try {
      setFilas(await parseArchivoXlsx(file))
    } catch (err) {
      setFilas(null)
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await processXlsxFile(file)
  }

  const { isDragging, dropProps } = useFileDrop(([file]) => { if (file) processXlsxFile(file) })

  function leerPegado() {
    setResultado(null)
    setParseError(null)
    try {
      setFilas(parseTextoPegado(pegado))
    } catch (err) {
      setFilas(null)
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  async function confirmar() {
    if (!filas) return
    onImportingChange(true)
    setFase('materiales')
    setParseError(null)
    try {
      const res = await importarFilasSapAConteo(conteoId, filas, setFase)
      setResultado(res)
      limpiarPreview()
      onImported()
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setFase(null)
      onImportingChange(false)
    }
  }

  return (
    <div {...dropProps}
      className={`bg-slate-800/60 rounded-xl border border-dashed p-3 space-y-2 transition-colors ${isDragging ? 'border-brand-500 bg-brand-500/10' : 'border-slate-600'}`}>
      <p className="text-[11px] text-slate-500">
        Cargar conteo desde Excel SAP — columnas Material/Texto breve de material/Lote/Libre utilización; el resto se ignora. Arrastra el .xlsx aquí o:
      </p>

      {!filas && (
        <div className="flex flex-wrap gap-2">
          <label className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white cursor-pointer">
            📎 Subir .xlsx
            <input type="file" accept=".xlsx" className="hidden" onChange={onFile} />
          </label>
          <button type="button" onClick={() => setModoPegar((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white">
            📋 Pegar desde Excel
          </button>
        </div>
      )}

      {modoPegar && !filas && (
        <div className="space-y-1.5">
          <textarea value={pegado} onChange={(e) => setPegado(e.target.value)} rows={4}
            placeholder="Copia las celdas en Excel (incluida la fila de encabezados) y pégalas aquí…"
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
          <button type="button" onClick={leerPegado} disabled={!pegado.trim()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
            Leer
          </button>
        </div>
      )}

      {parseError && <p className="text-xs text-red-400">{parseError}</p>}

      {filas && (
        <div className="space-y-2">
          <p className="text-xs text-slate-300">
            {filas.length} línea(s) reconocida(s). Se crearán los materiales que falten y "contada" quedará en el valor de Stock.
          </p>
          <div className="max-h-32 overflow-y-auto space-y-0.5 text-[11px] text-slate-400">
            {filas.slice(0, 8).map((f, i) => <p key={i}>{f.sku} — {f.descripcion} · lote {f.lote} · {f.cantidad}</p>)}
            {filas.length > 8 && <p className="text-slate-500">… y {filas.length - 8} más</p>}
          </div>
          {fase && (
            <p className="text-xs text-amber-400">
              {fase === 'materiales' ? 'Preparando materiales…' : 'Importando líneas…'}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={confirmar} disabled={!!fase}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
              {fase ? 'Importando…' : `Confirmar importación (${filas.length})`}
            </button>
            <button type="button" onClick={limpiarPreview} disabled={!!fase} className="text-xs text-slate-400">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <p className="text-xs text-green-400">
          Importado: {resultado.lineasCreadas} línea(s) nueva(s), {resultado.lineasActualizadas} actualizada(s)
          {resultado.materialesCreados > 0 ? `, ${resultado.materialesCreados} material(es) nuevo(s)` : ''}.
          {resultado.errores.length > 0 && <span className="text-red-400"> {resultado.errores.length} con error.</span>}
        </p>
      )}
    </div>
  )
}

function AgregarLineaForm({ conteoId, onAdded }: { conteoId: string; onAdded: () => void }) {
  const [materiales, setMateriales] = useState<Material[]>([])
  const [materialId, setMaterialId] = useState('')
  const [lote, setLote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { listMateriales().then(setMateriales).catch(() => {}) }, [])

  async function submit() {
    if (!materialId) { setError('Elige un material'); return }
    setBusy(true)
    setError(null)
    try {
      await agregarLineaConteo({ conteoId, materialId, lote: lote.trim() || undefined })
      setMaterialId('')
      setLote('')
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-slate-800/60 rounded-xl border border-dashed border-slate-600 p-3 space-y-2">
      <p className="text-[11px] text-slate-500">Material encontrado que no estaba en la lista:</p>
      <div className="flex gap-2">
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={`${inputCls} flex-1`}>
          <option value="">Material…</option>
          {materiales.map((m) => <option key={m.id} value={m.id}>{m.sku} — {m.apodo || m.descripcion}</option>)}
        </select>
        <input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote" className={`${inputCls} w-24`} />
        <button type="button" onClick={submit} disabled={busy}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 shrink-0">
          {busy ? '…' : '+ Agregar'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Catálogo de materiales (todos los SKU) — antes vivía en Administración
// (src/ui/admin/CatalogoMaterialesSection.tsx), movido acá para que lo vea
// todo el equipo de oficina (admin/jp/log), no solo admin — este módulo ya
// es inalcanzable para el rol técnico (su route 'Inicio' se filtra en
// App.tsx), así que no hace falta gateo aparte. Nombre alternativo =
// `apodo` (sin editor hasta ahora — caso real: "ODF 12 fibras" ⇄ "CMIC").
// ---------------------------------------------------------------------------

const NUEVO_TIPO = '__nuevo__'

function CatalogoTab() {
  const [materiales, setMateriales] = useState<Material[] | null>(null)
  const [tipos, setTipos] = useState<MaterialTipo[]>([])
  const [proveedoresCatalogo, setProveedoresCatalogo] = useState<Proveedor[]>([])
  const [codigosLpu, setCodigosLpu] = useState<LpuCodigo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  async function reload() {
    try {
      const [ms, ts, ps] = await Promise.all([listMateriales(), listMaterialTipos(), listProveedores()])
      setMateriales(ms)
      setTipos(ts)
      setProveedoresCatalogo(ps)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() }, [])
  useEffect(() => { listLpuCodigos().then(setCodigosLpu).catch((err) => setError(err instanceof Error ? err.message : String(err))) }, [])

  const filtrados = useMemo(() => {
    if (!materiales) return null
    const query = q.trim().toLowerCase()
    if (!query) return materiales
    return materiales.filter((m) =>
      m.sku.toLowerCase().includes(query) ||
      m.descripcion.toLowerCase().includes(query) ||
      (m.apodo ?? '').toLowerCase().includes(query))
  }, [materiales, q])

  function actualizarLocal(materialId: string, cambios: Partial<Material>) {
    setMateriales((prev) => (prev ?? []).map((m) => (m.id === materialId ? { ...m, ...cambios } : m)))
  }

  async function crearYAsignarTipo(materialId: string, nombre: string) {
    try {
      const nuevo = await crearMaterialTipo(nombre)
      setTipos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      await updateMaterialTipo(materialId, nuevo.id)
      actualizarLocal(materialId, { tipoId: nuevo.id, tipo: nuevo })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function crearProveedorCatalogo(nombre: string): Promise<Proveedor> {
    const nuevo = await crearProveedor(nombre)
    setProveedoresCatalogo((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    return nuevo
  }

  async function crearTipoCatalogo(nombre: string): Promise<MaterialTipo> {
    const nuevo = await crearMaterialTipo(nombre)
    setTipos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    return nuevo
  }

  function agregarMaterialLocal(m: Material) {
    setMateriales((prev) => [...(prev ?? []), m].sort((a, b) => compareSku(a.sku, b.sku, 'asc')))
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Todos los SKU: nombre alternativo (como se conoce en terreno), tipo (los de cable se consideran para el Estado de Pago), mínimo (alerta de stock bajo en Bodega) y proveedores.
      </p>

      <NuevoMaterialForm tipos={tipos} proveedoresCatalogo={proveedoresCatalogo}
        onCreated={agregarMaterialLocal} onNuevoTipo={crearTipoCatalogo} onNuevoProveedor={crearProveedorCatalogo} />

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, descripción o nombre alternativo…"
        className={`${inputCls} w-full`} />

      {error && <p className="text-xs text-red-400">{error}</p>}

      {filtrados === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700 max-h-[65vh] overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-slate-900 text-slate-400 text-left divide-x divide-slate-700">
                <th className="px-2 py-1.5">SKU</th>
                <th className="px-2 py-1.5">Descripción</th>
                <th className="px-2 py-1.5">Nombre alternativo</th>
                <th className="px-2 py-1.5">Tipo</th>
                <th className="px-2 py-1.5">Mínimo</th>
                <th className="px-2 py-1.5">Proveedores</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-3 text-center text-slate-500">Sin coincidencias.</td></tr>
              )}
              {filtrados.map((m) => (
                <FilaCatalogoMaterial key={m.id} material={m} tipos={tipos} proveedoresCatalogo={proveedoresCatalogo}
                  onApodoChange={(apodo) => actualizarLocal(m.id, { apodo })}
                  onMinimoSaved={reload}
                  onTipoChange={async (tipoId) => {
                    if (tipoId === NUEVO_TIPO) return
                    await updateMaterialTipo(m.id, tipoId || null)
                    actualizarLocal(m.id, { tipoId: tipoId || null, tipo: tipos.find((t) => t.id === tipoId) ?? null })
                  }}
                  onNuevoTipo={(nombre) => crearYAsignarTipo(m.id, nombre)}
                  onNuevoProveedor={crearProveedorCatalogo}
                  onProveedoresChange={async (proveedores) => {
                    await updateMaterialProveedores(m.id, proveedores.map((p) => p.id))
                    actualizarLocal(m.id, { proveedores })
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material → Código LPU</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Qué línea del Estado de Pago sugiere cada material instalado (ej. mufa → confección + fusión), y el tipo de tendido/capacidad de los SKUs de cable.
          </p>
        </div>
        {!materiales || !codigosLpu ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : (
          <LpuMaterialMapEditor materiales={materiales} codigos={codigosLpu} />
        )}
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Tendido → Código LPU</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Qué código LPU corresponde a cada combinación de tipo de tendido + rango de capacidad (n° de hilos).
          </p>
        </div>
        {!codigosLpu ? <p className="text-xs text-slate-500">Cargando…</p> : <LpuTendidoMapEditor codigos={codigosLpu} />}
      </div>
    </div>
  )
}

function NuevoMaterialForm({ tipos, proveedoresCatalogo, onCreated, onNuevoTipo, onNuevoProveedor }: {
  tipos: MaterialTipo[]
  proveedoresCatalogo: Proveedor[]
  onCreated: (m: Material) => void
  onNuevoTipo: (nombre: string) => Promise<MaterialTipo>
  onNuevoProveedor: (nombre: string) => Promise<Proveedor>
}) {
  const [open, setOpen] = useState(false)
  const [sku, setSku] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [apodo, setApodo] = useState('')
  const [tipoId, setTipoId] = useState('')
  const [minimo, setMinimo] = useState('')
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [creandoTipo, setCreandoTipo] = useState(false)
  const [nombreNuevoTipo, setNombreNuevoTipo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setSku(''); setDescripcion(''); setApodo(''); setTipoId(''); setMinimo('')
    setProveedores([]); setCreandoTipo(false); setNombreNuevoTipo(''); setError(null)
  }

  async function confirmarNuevoTipo() {
    const nombre = nombreNuevoTipo.trim()
    if (!nombre) return
    try {
      const nuevo = await onNuevoTipo(nombre)
      setTipoId(nuevo.id)
      setNombreNuevoTipo('')
      setCreandoTipo(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function guardar() {
    if (!sku.trim() || !descripcion.trim()) {
      setError('SKU y descripción son obligatorios.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const nuevo = await crearMaterial({
        sku: sku.trim(),
        descripcion: descripcion.trim(),
        apodo: apodo.trim() || null,
        tipoId: tipoId || null,
        stockMinimo: minimo.trim() === '' ? null : Number(minimo),
      })
      if (proveedores.length > 0) {
        await updateMaterialProveedores(nuevo.id, proveedores.map((p) => p.id))
      }
      onCreated({ ...nuevo, tipo: tipos.find((t) => t.id === tipoId) ?? null, proveedores })
      reset()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs font-semibold text-brand-400 hover:text-brand-300 border-2 border-dashed border-slate-600 hover:border-brand-500 rounded-xl px-3 py-2 w-full transition-colors">
        ➕ Agregar material
      </button>
    )
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Nuevo material</h3>
        <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-slate-500 hover:text-slate-300 text-xs">
          ✕ Cancelar
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">SKU <span className="text-red-400">*</span></label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. 123456" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Descripción <span className="text-red-400">*</span></label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción SAP" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nombre alternativo</label>
          <input value={apodo} onChange={(e) => setApodo(e.target.value)} placeholder="Como se conoce en terreno (opcional)" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Mínimo</label>
          <input type="number" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="Alerta de stock bajo (opcional)" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tipo</label>
          {creandoTipo ? (
            <div className="flex gap-1">
              <input autoFocus value={nombreNuevoTipo} onChange={(e) => setNombreNuevoTipo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmarNuevoTipo(); if (e.key === 'Escape') setCreandoTipo(false) }}
                placeholder="Nombre del tipo…" className={`${inputCls} flex-1`} />
              <button type="button" onClick={confirmarNuevoTipo} className="text-brand-400 hover:text-brand-300 text-xs shrink-0">✓</button>
              <button type="button" onClick={() => setCreandoTipo(false)} className="text-slate-500 hover:text-slate-300 text-xs shrink-0">✕</button>
            </div>
          ) : (
            <select value={tipoId}
              onChange={(e) => e.target.value === NUEVO_TIPO ? setCreandoTipo(true) : setTipoId(e.target.value)}
              className={`${inputCls} w-full`}>
              <option value="">(vacío)</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              <option value={NUEVO_TIPO}>+ Nuevo tipo…</option>
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Proveedores</label>
          <ProveedoresSelect value={proveedores} catalogo={proveedoresCatalogo}
            onChange={setProveedores} onNuevoProveedor={onNuevoProveedor} />
        </div>
      </div>

      <button type="button" onClick={guardar} disabled={saving}
        className="w-full py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 disabled:opacity-50">
        {saving ? 'Guardando…' : 'Guardar material'}
      </button>
    </div>
  )
}

function FilaCatalogoMaterial({ material, tipos, proveedoresCatalogo, onApodoChange, onMinimoSaved, onTipoChange, onNuevoTipo, onNuevoProveedor, onProveedoresChange }: {
  material: Material
  tipos: MaterialTipo[]
  proveedoresCatalogo: Proveedor[]
  onApodoChange: (apodo: string | null) => void
  onMinimoSaved: () => void
  onTipoChange: (tipoId: string) => void
  onNuevoTipo: (nombre: string) => void
  onNuevoProveedor: (nombre: string) => Promise<Proveedor>
  onProveedoresChange: (proveedores: Proveedor[]) => void
}) {
  const [apodo, setApodo] = useState(material.apodo ?? '')
  const [creandoTipo, setCreandoTipo] = useState(false)
  const [nombreNuevoTipo, setNombreNuevoTipo] = useState('')

  useEffect(() => { setApodo(material.apodo ?? '') }, [material.apodo])

  async function guardarApodo() {
    const valor = apodo.trim()
    if (valor === (material.apodo ?? '')) return
    await updateMaterialApodo(material.id, valor || null)
    onApodoChange(valor || null)
  }

  function elegirTipo(value: string) {
    if (value === NUEVO_TIPO) {
      setCreandoTipo(true)
      return
    }
    onTipoChange(value)
  }

  function confirmarNuevoTipo() {
    const nombre = nombreNuevoTipo.trim()
    if (!nombre) return
    onNuevoTipo(nombre)
    setNombreNuevoTipo('')
    setCreandoTipo(false)
  }

  return (
    <tr className="border-t border-slate-800">
      <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{material.sku}</td>
      <td className="px-2 py-1.5 text-slate-300">{material.descripcion}</td>
      <td className="px-2 py-1.5">
        <input value={apodo} onChange={(e) => setApodo(e.target.value)} onBlur={guardarApodo}
          placeholder="—" className="w-full bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      </td>
      <td className="px-2 py-1.5">
        {creandoTipo ? (
          <div className="flex gap-1">
            <input autoFocus value={nombreNuevoTipo} onChange={(e) => setNombreNuevoTipo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmarNuevoTipo(); if (e.key === 'Escape') setCreandoTipo(false) }}
              placeholder="Nombre del tipo…" className="w-28 bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <button type="button" onClick={confirmarNuevoTipo} className="text-brand-400 hover:text-brand-300 text-xs">✓</button>
            <button type="button" onClick={() => setCreandoTipo(false)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
          </div>
        ) : (
          <select value={material.tipoId ?? ''} onChange={(e) => elegirTipo(e.target.value)}
            className="w-36 bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
            <option value="">(vacío)</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            <option value={NUEVO_TIPO}>+ Nuevo tipo…</option>
          </select>
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {/* Mismo umbral que Bodega (stock_minimo) — editarlo acá alimenta la
            misma alerta roja/ámbar de esa pestaña, no es un campo aparte. */}
        <UmbralEditor materialId={material.id} value={material.stockMinimo} onSaved={onMinimoSaved} />
      </td>
      <td className="px-2 py-1.5">
        <ProveedoresSelect value={material.proveedores} catalogo={proveedoresCatalogo}
          onChange={onProveedoresChange} onNuevoProveedor={onNuevoProveedor} />
      </td>
    </tr>
  )
}

function ProveedoresSelect({ value, catalogo, onChange, onNuevoProveedor }: {
  value: Proveedor[]
  catalogo: Proveedor[]
  onChange: (proveedores: Proveedor[]) => void
  onNuevoProveedor: (nombre: string) => Promise<Proveedor>
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  // Los toggles se acumulan en estado local MIENTRAS el popover está abierto
  // y se guardan de una sola vez al cerrarlo — no en cada clic. Guardar por
  // clic dispara un PATCH a Supabase por checkbox marcado; con dos clics
  // rápidos (Entel y luego CLEH) quedan dos escrituras en carrera sobre la
  // misma fila, y la que responde último pisa a la otra aunque haya salido
  // primero (confirmado en el navegador: marcar dos seguidos solo dejaba
  // guardado uno, en distinto orden cada vez). Una sola escritura al cerrar
  // elimina la carrera de raíz en vez de solo evitar el closure viejo.
  const [local, setLocal] = useState(value)
  const [creando, setCreando] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')

  function abrir(e: React.MouseEvent<HTMLButtonElement>) {
    if (!open) {
      const r = e.currentTarget.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 220) })
      setLocal(value)
    }
    setOpen((v) => !v)
  }

  function cerrarYGuardar() {
    setOpen(false)
    setCreando(false)
    const cambio = local.length !== value.length || local.some((p) => !value.some((v) => v.id === p.id))
    if (cambio) onChange(local)
  }

  function toggleProveedor(p: Proveedor) {
    setLocal((prev) => (prev.some((v) => v.id === p.id) ? prev.filter((v) => v.id !== p.id) : [...prev, p]))
  }

  async function confirmarNuevo() {
    const nombre = nombreNuevo.trim()
    if (!nombre) return
    const nuevo = await onNuevoProveedor(nombre)
    setLocal((prev) => [...prev, nuevo])
    setNombreNuevo('')
    setCreando(false)
  }

  return (
    <div>
      <button type="button" onClick={abrir}
        className="w-full text-left bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none truncate">
        {value.length > 0 ? value.map((p) => p.nombre).join(', ') : <span className="text-slate-500">—</span>}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={cerrarYGuardar} />
          <div style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2 space-y-1">
            {catalogo.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-xs text-slate-200 px-1 py-1 rounded hover:bg-slate-700 cursor-pointer">
                <input type="checkbox" checked={local.some((v) => v.id === p.id)} onChange={() => toggleProveedor(p)} />
                {p.nombre}
              </label>
            ))}
            <div className="border-t border-slate-700 pt-1 mt-1">
              {creando ? (
                <div className="flex gap-1">
                  <input autoFocus value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmarNuevo(); if (e.key === 'Escape') setCreando(false) }}
                    placeholder="Nombre del proveedor…" className="w-32 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                  <button type="button" onClick={confirmarNuevo} className="text-brand-400 hover:text-brand-300 text-xs">✓</button>
                  <button type="button" onClick={() => setCreando(false)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
                </div>
              ) : (
                <button type="button" onClick={() => setCreando(true)} className="text-xs text-brand-400 hover:text-brand-300">
                  + Nuevo proveedor…
                </button>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Material/Tendido → Código LPU — antes vivían en Administración
// (src/ui/admin/LpuMapeoSection.tsx), movidas acá junto con el resto del
// Catálogo de materiales (mismo motivo: lo usa todo el equipo de oficina,
// no solo admin). Primera versión — a propósito simple (buscador de texto,
// sin ColumnHeader) porque se busca UN material o UNA fila a la vez.
// ---------------------------------------------------------------------------

function LpuMaterialMapEditor({ materiales, codigos }: { materiales: Material[]; codigos: LpuCodigo[] }) {
  const [materialId, setMaterialId] = useState('')
  const material = materiales.find((m) => m.id === materialId) ?? null

  const [tipoTendido, setTipoTendido] = useState('')
  const [capacidad, setCapacidad] = useState('')
  const [savingTendido, setSavingTendido] = useState(false)
  const [tendidoMsg, setTendidoMsg] = useState<string | null>(null)

  const [mapas, setMapas] = useState<LpuMaterialMap[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nuevoCodigoId, setNuevoCodigoId] = useState('')
  const [nuevoFactor, setNuevoFactor] = useState('1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTendidoMsg(null)
    if (!material) { setTipoTendido(''); setCapacidad(''); setMapas(null); return }
    setTipoTendido(material.tipoTendido ?? '')
    setCapacidad(material.capacidad === null ? '' : String(material.capacidad))
    reload(material.id)
  }, [materialId]) // eslint-disable-line react-hooks/exhaustive-deps

  function reload(id: string) {
    setMapas(null)
    listLpuMaterialMapPorMaterial(id).catch((err) => { setError(err instanceof Error ? err.message : String(err)); return [] }).then(setMapas)
  }

  const tendidoDirty = material && (
    tipoTendido !== (material.tipoTendido ?? '') ||
    capacidad !== (material.capacidad === null ? '' : String(material.capacidad))
  )

  async function guardarTendido() {
    if (!material) return
    setSavingTendido(true)
    setTendidoMsg(null)
    try {
      await updateMaterialTendido(material.id, {
        tipoTendido: tipoTendido.trim() || null,
        capacidad: capacidad.trim() === '' ? null : Number(capacidad),
      })
      setTendidoMsg('Guardado')
    } catch (err) {
      setTendidoMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingTendido(false)
    }
  }

  async function agregar() {
    if (!material || !nuevoCodigoId) return
    setBusy(true)
    setError(null)
    try {
      await crearLpuMaterialMap({ materialId: material.id, lpuCodigoId: nuevoCodigoId, factorCantidad: Number(nuevoFactor) || 1 })
      setNuevoCodigoId('')
      setNuevoFactor('1')
      reload(material.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function quitar(id: string) {
    setBusy(true)
    setError(null)
    try {
      await borrarLpuMaterialMap(id)
      if (material) reload(material.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActivo(m: LpuMaterialMap) {
    setBusy(true)
    setError(null)
    try {
      await actualizarLpuMaterialMap(m.id, { activo: !m.activo })
      if (material) reload(material.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <MaterialSelect materiales={materiales} value={materialId} onChange={setMaterialId} placeholder="Buscar material…" />

      {material && (
        <div className="bg-slate-700/50 rounded-xl p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 items-end">
            <label className="text-xs text-slate-300 space-y-1">
              <span>Tipo de tendido (solo cables)</span>
              <input value={tipoTendido} onChange={(e) => setTipoTendido(e.target.value)} placeholder="Subterráneo / Aéreo…"
                className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            </label>
            <label className="text-xs text-slate-300 space-y-1">
              <span>Capacidad (n° de hilos)</span>
              <input value={capacidad} onChange={(e) => setCapacidad(e.target.value)} type="number" placeholder="ej. 24"
                className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            {tendidoMsg && <p className="text-xs text-slate-400">{tendidoMsg}</p>}
            <button type="button" onClick={guardarTendido} disabled={!tendidoDirty || savingTendido}
              className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
              {savingTendido ? 'Guardando…' : 'Guardar tendido'}
            </button>
          </div>

          <div className="border-t border-slate-700 pt-2 space-y-1.5">
            <p className="text-[11px] text-slate-500">Códigos LPU que sugiere este material:</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            {mapas === null ? (
              <p className="text-xs text-slate-500">Cargando…</p>
            ) : mapas.length === 0 ? (
              <p className="text-xs text-slate-500">Sin códigos asociados todavía.</p>
            ) : (
              mapas.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 bg-slate-700 rounded-lg px-3 py-2 text-xs">
                  <div className={`min-w-0 truncate ${m.activo ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
                    {m.lpuCodigo ? `${m.lpuCodigo.codigoAtt} — ${m.lpuCodigo.partida || m.lpuCodigo.descripcion}` : m.lpuCodigoId}
                    <span className="text-slate-500"> · factor {m.factorCantidad}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => toggleActivo(m)} disabled={busy}
                      className="text-slate-400 hover:text-brand-300 disabled:opacity-40">
                      {m.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" onClick={() => quitar(m.id)} disabled={busy}
                      className="text-slate-500 hover:text-red-400 text-base leading-none disabled:opacity-40">×</button>
                  </div>
                </div>
              ))
            )}
            <div className="flex gap-2 items-end pt-1">
              <LpuCodigoSelect codigos={codigos} value={nuevoCodigoId} onChange={setNuevoCodigoId} className="flex-1 min-w-0" />
              <input value={nuevoFactor} onChange={(e) => setNuevoFactor(e.target.value)} type="number" step="any" placeholder="Factor"
                className="w-20 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
              <button type="button" onClick={agregar} disabled={!nuevoCodigoId || busy}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
                + Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LpuTendidoMapEditor({ codigos }: { codigos: LpuCodigo[] }) {
  const [filas, setFilas] = useState<LpuTendidoMap[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [tipoTendido, setTipoTendido] = useState('')
  const [capMin, setCapMin] = useState('')
  const [capMax, setCapMax] = useState('')
  const [codigoId, setCodigoId] = useState('')

  const tiposConocidos = useMemo(
    () => Array.from(new Set((filas ?? []).map((f) => f.tipoTendido))).sort(),
    [filas],
  )

  function reload() {
    setFilas(null)
    listLpuTendidoMap().catch((err) => { setError(err instanceof Error ? err.message : String(err)); return [] }).then(setFilas)
  }

  useEffect(reload, [])

  async function agregar() {
    if (!tipoTendido.trim() || !codigoId) return
    setBusy(true)
    setError(null)
    try {
      await crearLpuTendidoMap({
        tipoTendido: tipoTendido.trim(),
        capacidadMin: capMin.trim() === '' ? null : Number(capMin),
        capacidadMax: capMax.trim() === '' ? null : Number(capMax),
        lpuCodigoId: codigoId,
      })
      setTipoTendido(''); setCapMin(''); setCapMax(''); setCodigoId('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActivo(f: LpuTendidoMap) {
    setBusy(true)
    setError(null)
    try {
      await actualizarLpuTendidoMap(f.id, !f.activo)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function quitar(id: string) {
    setBusy(true)
    setError(null)
    try {
      await borrarLpuTendidoMap(id)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {filas === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="text-xs text-slate-500">Sin filas todavía.</p>
      ) : (
        <div className="space-y-1.5">
          {filas.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 bg-slate-700/50 rounded-lg px-3 py-2 text-xs">
              <div className={`min-w-0 truncate ${f.activo ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
                <span className="font-medium">{f.tipoTendido}</span>
                <span className="text-slate-500"> · {f.capacidadMin ?? '—'}–{f.capacidadMax ?? '—'} hilos → </span>
                {f.lpuCodigo ? `${f.lpuCodigo.codigoAtt} — ${f.lpuCodigo.partida || f.lpuCodigo.descripcion}` : f.lpuCodigoId}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => toggleActivo(f)} disabled={busy}
                  className="text-slate-400 hover:text-brand-300 disabled:opacity-40">
                  {f.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button type="button" onClick={() => quitar(f.id)} disabled={busy}
                  className="text-slate-500 hover:text-red-400 text-base leading-none disabled:opacity-40">×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end pt-1">
        <label className="text-xs text-slate-300 space-y-1 col-span-2 sm:col-span-1">
          <span>Tipo de tendido</span>
          <input value={tipoTendido} onChange={(e) => setTipoTendido(e.target.value)} placeholder="Subterráneo…" list="tipos-tendido-conocidos"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
          <datalist id="tipos-tendido-conocidos">
            {tiposConocidos.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>Capacidad mín.</span>
          <input value={capMin} onChange={(e) => setCapMin(e.target.value)} type="number" placeholder="sin límite"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>Capacidad máx.</span>
          <input value={capMax} onChange={(e) => setCapMax(e.target.value)} type="number" placeholder="sin límite"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        </label>
        <LpuCodigoSelect codigos={codigos} value={codigoId} onChange={setCodigoId} className="col-span-2 sm:col-span-4" />
        <button type="button" onClick={agregar} disabled={!tipoTendido.trim() || !codigoId || busy}
          className="col-span-2 sm:col-span-4 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
          + Agregar
        </button>
      </div>
    </div>
  )
}
