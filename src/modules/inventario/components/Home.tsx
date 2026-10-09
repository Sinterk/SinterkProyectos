import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary, MemberProfile } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import type { Profile } from '@/lib/auth'
import { esTipoInsumo } from '@/lib/inventario/esInsumo'
import { LpuCodigoSelect } from '@/ui/LpuCodigoSelect'
import { MaterialSelect } from '@/ui/MaterialSelect'
import { RegistrarMovimientoForm } from '@/ui/RegistrarMovimientoForm'
import { AsignacionesForm } from './AsignacionesForm'
import { ExportarStockExcelButton } from './ExportarStockExcelModal'
import { ListaRegistros } from './ListaRegistros'
import { ResumenProyectoTable } from '@/ui/ResumenProyectoTable'
import { UbicacionSelect } from '@/ui/UbicacionSelect'
import { useFileDrop } from '@/ui/useFileDrop'
import {
  getStock, listMovimientos, anularMovimiento, listMateriales, listUbicaciones, TIPO_LABELS_MOV,
  updateMaterialStockMinimo, updateMaterialComentario, updateMaterialTendido, crearMaterial,
  listMaterialTipos, crearMaterialTipo, updateMaterialApodo, updateMaterialDescripcion, updateMaterialTipo,
  listProveedores, crearProveedor, updateMaterialProveedores,
  listPaquetes, crearPaquete, eliminarPaquete, updatePaqueteMateriales,
  listConteos, getConteoLineas, abrirConteo, agregarLineaConteo, actualizarLineaConteo, cerrarConteo, descartarConteo,
  listEventosInventario, listEventosPorConteo, resolverEvento, importarFilasSapAConteo, listClavesStockNegativo, reconocerEventos,
  listStockDeTrabajadores, listMovimientosDeTrabajadores,
} from '@/lib/inventario/inventarioRepo'
import type { ListMovimientosFilters, ImportarSapResultado, StockDeTrabajador, MovimientoDeTrabajador } from '@/lib/inventario/inventarioRepo'
import type {
  Movimiento, StockRow, Ubicacion, Material, MaterialTipo, Proveedor, Paquete,
  Conteo, ConteoLinea, EventoInventario, EventoResolucion, ResolucionTipo, ConsumoArea, UbicacionTipo,
} from '@/lib/inventario/types'
import { parseArchivoXlsx, parseTextoPegado } from '@/lib/inventario/importarSap'
import type { FilaImportSap } from '@/lib/inventario/importarSap'
import { compareSku } from '@/lib/inventario/sku'
import {
  listLpuCodigos, listLpuMaterialMapPorMaterial, listLpuMaterialMapTodos, crearLpuMaterialMap, actualizarLpuMaterialMap, borrarLpuMaterialMap,
} from '@/lib/lpu/lpuRepo'
import type { LpuCodigo, LpuMaterialMap } from '@/lib/lpu/types'
import { ColumnHeader } from '@/ui/ColumnHeader'

type MainTab = 'registro' | 'stock' | 'conteo' | 'movimientos' | 'catalogo'
type StockSubTab = 'bodega' | 'proyecto' | 'tecnico'

const inputCls = 'bg-slate-800 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-700 focus:border-brand-500 focus:outline-none'

export function Home() {
  const [tab, setTab] = useState<MainTab>('registro')
  // Registrar algo en Registro tiene que verse reflejado en Movimientos.
  // Cuando las dos eran subpestañas del mismo componente el contador vivía
  // ahí adentro; ahora que son pestañas principales hermanas, vive acá.
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">📦 Inventario</h1>
        <p className="text-xs text-slate-400">Materiales, stock y movimientos.</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <TabButton active={tab === 'registro'} onClick={() => setTab('registro')}>Registro</TabButton>
        <TabButton active={tab === 'stock'} onClick={() => setTab('stock')}>Stock</TabButton>
        <TabButton active={tab === 'conteo'} onClick={() => setTab('conteo')}>Conteo</TabButton>
        <TabButton active={tab === 'movimientos'} onClick={() => setTab('movimientos')}>Movimientos</TabButton>
        <TabButton active={tab === 'catalogo'} onClick={() => setTab('catalogo')}>Catálogo</TabButton>
      </div>

      {tab === 'registro' && <RegistroTab onRegistered={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'stock' && <StockTab />}
      {tab === 'conteo' && <ConteoTab />}
      {tab === 'movimientos' && <MovimientosTab refreshKey={refreshKey} />}
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

/** Subpestaña (segundo nivel): ocupa el ancho a partes iguales, a diferencia del primer nivel que hace scroll horizontal. */
function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
      {children}
    </button>
  )
}

function RegistroTab({ onRegistered }: { onRegistered: () => void }) {
  const [sub, setSub] = useState<'asignaciones' | 'entrada'>('asignaciones')
  // Doble propósito: recarga la lista de abajo, y avisa al padre para que la
  // pestaña Movimientos también quede al día.
  const [refreshKey, setRefreshKey] = useState(0)
  function registrado() {
    setRefreshKey((k) => k + 1)
    onRegistered()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <SubTabButton active={sub === 'asignaciones'} onClick={() => setSub('asignaciones')}>Asignaciones</SubTabButton>
        <SubTabButton active={sub === 'entrada'} onClick={() => setSub('entrada')}>Entrada</SubTabButton>
      </div>
      {sub === 'asignaciones'
        ? <AsignacionesForm onRegistered={registrado} />
        : <RegistrarMovimientoForm soloEntrada onRegistered={registrado} />}
      <ListaRegistros modo={sub} refreshKey={refreshKey} />
    </div>
  )
}

function StockTab() {
  const [sub, setSub] = useState<StockSubTab>('bodega')

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="flex gap-2 flex-1">
          <SubTabButton active={sub === 'bodega'} onClick={() => setSub('bodega')}>Bodega</SubTabButton>
          <SubTabButton active={sub === 'proyecto'} onClick={() => setSub('proyecto')}>Proyecto</SubTabButton>
          <SubTabButton active={sub === 'tecnico'} onClick={() => setSub('tecnico')}>Técnico</SubTabButton>
        </div>
        <ExportarStockExcelButton />
      </div>
      {sub === 'bodega' && <BodegaTab />}
      {sub === 'proyecto' && <ProyectoTab />}
      {sub === 'tecnico' && <TecnicoTab />}
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
  // Sin filtros se cargan solo los 200 movimientos más recientes (para que la
  // pestaña abra rápido). Los filtros por columna (tipo, bodega…) se aplican
  // sobre lo YA cargado, así que con ellos —o con el buscador— hace falta traer
  // todo el historial; si no, un tipo/bodega "no aparece" solo porque sus
  // movimientos son más viejos que esa ventana.
  const [todos, setTodos] = useState(false)

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
      // Con texto de búsqueda, se saca el límite de 200 (que existe solo para
      // que la vista "sin filtros" cargue rápido) — si no, el buscador nunca
      // encuentra un OTT/SKU viejo que quedó fuera de esa ventana reciente.
      if (search.trim() || todos) filters.limit = null
      setRows(await listMovimientos(filters))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [desde, hasta, search, refreshKey, todos])
  // Al filtrar por una columna se trae todo el historial (ver `todos`).
  useEffect(() => { if (Object.keys(colSelected).length > 0) setTodos(true) }, [colSelected])

  async function handleAnular(m: Movimiento) {
    const detalle = `${TIPO_LABELS_MOV[m.tipo] ?? m.tipo} — ${m.materialSku} (${m.cantidad}) — ${m.fecha.slice(0, 10)}`
    // Aviso extra para la instalación forzada: al anularla se borra también el
    // evento de revisión que generó, con sus resoluciones. Eso NO revierte lo
    // que esas resoluciones movieron — cada una dejó su propio movimiento en
    // esta misma tabla y hay que anularlo aparte (ver 0058).
    const aviso = m.requiereRevision
      ? '\n\nOJO: este movimiento generó un evento de revisión. Al anularlo se borra ese evento y sus resoluciones. Lo que esas resoluciones movieron NO se revierte acá: cada una dejó su propio movimiento en esta tabla, y hay que anularlo por separado.'
      : ''
    if (!confirm(`¿Anular este movimiento?\n\n${detalle}\n\nEsto revierte el stock que movió y borra el registro. No se puede deshacer.${aviso}`)) return
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
      {rows !== null && rows.length >= 200 && !todos && !search.trim() && (
        <p className="text-[11px] text-amber-400">
          Mostrando solo los 200 movimientos más recientes (desde {rows[rows.length - 1].fecha.slice(0, 10)}).{' '}
          <button type="button" onClick={() => setTodos(true)} className="underline font-semibold">Cargar todos</button>
          {' '}— se cargan solos al filtrar por una columna o al buscar.
        </p>
      )}
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
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                    {m.lote}
                    {m.soloFisico && <span title="Compra propia — no toca el stock digital de SAP" className="ml-1 text-amber-400">🏷️</span>}
                  </td>
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
    try { setRows(await getStock({ ubicacionId: ubicacionId || undefined, search: search || undefined, soloBodega: true })) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ubicacionId, search])

  // Un lote en 0 físico y 0 digital no se muestra en el stock (queda solo en el
  // historial de movimientos), sin excepciones: un material con umbral que se
  // agotó (porque se repone con uno similar) tampoco deja fila. "Renovar" solo
  // aparece mientras quede algo.
  const filasVisibles = useMemo(
    () => (rows ? rows.filter((r) => r.cantidadFisico !== 0 || r.cantidadDigital !== 0) : null),
    [rows])

  const valuesByColumn = useMemo(() => {
    const result = {} as Record<StockColKey, string[]>
    for (const col of STOCK_COLUMNS) {
      result[col.key] = sortColumnValues(col.key, [...new Set((filasVisibles ?? []).map((r) => stockColDisplayValue(r, col.key)))])
    }
    return result
  }, [filasVisibles])

  const displayRows = useMemo(() => {
    if (!filasVisibles) return null
    let out = filasVisibles
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
  }, [filasVisibles, colSelected, sort])

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
      ) : filasVisibles && filasVisibles.length === 0 ? (
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

const SIN_PROYECTO_TEC = '🅿️ Sin proyecto'

const TIPOS_TECNICO = ['salida', 'instalado', 'traslado', 'rebaja', 'merma', 'ajuste', 'solicitud'] as const

/**
 * Impacto real en el stock FÍSICO PROPIO del trabajador — no alcanza con
 * mirar el tipo, `usuario_id` no siempre es de quién cambió el stock de
 * verdad (ver `registrar_movimiento`/`anular_movimiento`,
 * 0067_entrada_solo_fisico.sql, verificado contra la BD real: sin estos 3
 * casos el saldo calculado no calzaba con el stock real de `getStock`):
 *
 * - 'instalado' puede tomar el material del stock de OTRO integrante del
 *   mismo proyecto si el propio no alcanzaba — el movimiento queda a
 *   nombre de este trabajador (para atribuirle la instalación) pero su
 *   stock no cambió. Solo se sabe mirando si `ubicacionId` del movimiento
 *   es su propia ubicación (si no, se lo tomaron a otro compañero).
 * - 'rebaja' (Rebajado SAP) ajusta el digital de la BODEGA de origen,
 *   nunca el stock del trabajador.
 * - 'traslado' (Devuelto) normalmente sí debita su stock, salvo que sea la
 *   reasignación a un preventivo al cerrar un proyecto (puro bookkeeping —
 *   el material ya estaba físicamente con él desde la entrega).
 * - 'solicitud' nunca tocó stock, es solo un registro previo al instalado.
 */
function impactoParaTecnico(m: Movimiento, tecnicoUbicacionId: string | null): number {
  const esReasignacionPreventivo = m.nota === 'Reasignado a preventivo al cerrar proyecto' || (m.documento ?? '').startsWith('PREVENTIVO - ')
  switch (m.tipo) {
    case 'salida':
    case 'ajuste':
      return m.cantidad
    case 'instalado':
      return m.ubicacionId === tecnicoUbicacionId ? -m.cantidad : 0
    case 'traslado':
      return esReasignacionPreventivo ? 0 : -m.cantidad
    case 'merma':
      return -m.cantidad
    default:
      return 0 // 'rebaja', 'solicitud': nunca tocan el stock propio del trabajador
  }
}

type TriFiltro = 'cualquiera' | 'si' | 'no'
type PeriodoMov = 'todo' | '7' | '30' | '90'

/**
 * "¿A quién revisar?": una fila por trabajador con lo que tiene en posesión y
 * sus movimientos, filtrable por material, por si tiene/no tiene material, por
 * stock negativo y por si ha tenido movimientos (en todo el historial o en los
 * últimos N días) — para ver rápido a cuáles técnicos conviene ir a revisarles
 * el material. Con un material elegido, "posesión" y "movimientos" se refieren
 * a ESE material. Un clic en la fila abre el detalle del trabajador, abajo.
 */
function BuscadorTrabajadores({ trabajadores, onElegir }: { trabajadores: Profile[]; onElegir: (id: string) => void }) {
  const [materiales, setMateriales] = useState<Material[]>([])
  const [stock, setStock] = useState<StockDeTrabajador[] | null>(null)
  const [movs, setMovs] = useState<MovimientoDeTrabajador[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  /** Bodega de origen: de cuál bodega recibió el trabajador el material (Entregas). '' = cualquiera. */
  const [bodegaId, setBodegaId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [posesion, setPosesion] = useState<TriFiltro>('cualquiera')
  const [negativo, setNegativo] = useState(false)
  const [conMovs, setConMovs] = useState<TriFiltro>('cualquiera')
  const [periodo, setPeriodo] = useState<PeriodoMov>('todo')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    listMateriales().then(setMateriales).catch(() => {})
    listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {})
    listStockDeTrabajadores().then(setStock).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    listMovimientosDeTrabajadores(TIPOS_TECNICO).then(setMovs).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const filas = useMemo(() => {
    if (!stock || !movs) return null
    const desdeMs = periodo === 'todo' ? 0 : Date.now() - Number(periodo) * 86400000
    // Los insumos solo se entregan: no tienen "posesión" ni stock negativo (ver esInsumo.ts).
    const insumoIds = new Set(materiales.filter((m) => esTipoInsumo(m.tipo?.nombre)).map((m) => m.id))
    const stockPorUsuario = new Map<string, StockDeTrabajador[]>()
    for (const r of stock) {
      if (insumoIds.has(r.materialId)) continue
      if (materialId && r.materialId !== materialId) continue
      stockPorUsuario.set(r.ownerUserId, [...(stockPorUsuario.get(r.ownerUserId) ?? []), r])
    }
    // Bodega(s) de origen de cada material+lote que tiene un trabajador: de las
    // Entregas ('salida') que recibió — toda la historia, no solo el período.
    // El stock de un trabajador no guarda de dónde vino; esto lo deduce por lote.
    const origenes = new Map<string, Set<string>>()
    for (const m of movs) {
      if (m.tipo !== 'salida') continue
      const k = `${m.usuarioId}|${m.materialId}|${m.lote}`
      const set = origenes.get(k) ?? new Set<string>()
      set.add(m.ubicacionId)
      origenes.set(k, set)
    }
    const nombreBodega = new Map(bodegas.map((b) => [b.id, b.nombre]))
    const movsPorUsuario = new Map<string, MovimientoDeTrabajador[]>()
    for (const m of movs) {
      if (materialId && m.materialId !== materialId) continue
      if (desdeMs && new Date(m.fecha).getTime() < desdeMs) continue
      // Con bodega de origen, "movimientos" son las Entregas desde esa bodega.
      if (bodegaId && !(m.tipo === 'salida' && m.ubicacionId === bodegaId)) continue
      movsPorUsuario.set(m.usuarioId, [...(movsPorUsuario.get(m.usuarioId) ?? []), m])
    }
    return trabajadores.map((t) => {
      let sr = (stockPorUsuario.get(t.id) ?? []).filter((r) => r.cantidadFisico !== 0 || r.cantidadDigital !== 0)
      // Con bodega de origen, solo cuenta lo que ese trabajador recibió de ESA bodega.
      if (bodegaId) sr = sr.filter((r) => origenes.get(`${t.id}|${r.materialId}|${r.lote}`)?.has(bodegaId))
      const ms = movsPorUsuario.get(t.id) ?? []
      const idsOrigen = new Set<string>()
      for (const r of sr) for (const b of origenes.get(`${t.id}|${r.materialId}|${r.lote}`) ?? []) idsOrigen.add(b)
      return {
        id: t.id,
        nombre: t.nombre?.trim() || t.email || '',
        origen: [...idsOrigen].map((id) => nombreBodega.get(id) ?? '?').sort().join(', '),
        skus: new Set(sr.map((r) => r.materialId)).size,
        fisico: sr.reduce((a, r) => a + r.cantidadFisico, 0),
        digital: sr.reduce((a, r) => a + r.cantidadDigital, 0),
        negativos: sr.filter((r) => r.cantidadFisico < 0 || r.cantidadDigital < 0).length,
        movimientos: ms.length,
        entregado: ms.filter((m) => m.tipo === 'salida').reduce((a, m) => a + m.cantidad, 0),
        ultimo: ms.length > 0 ? ms.reduce((a, m) => (m.fecha > a ? m.fecha : a), ms[0].fecha).slice(0, 10) : null,
      }
    })
  }, [stock, movs, trabajadores, materialId, periodo, materiales, bodegaId, bodegas])

  const visibles = useMemo(() => {
    if (!filas) return null
    const q = busqueda.trim().toLowerCase()
    return filas
      .filter((f) => !q || f.nombre.toLowerCase().includes(q))
      .filter((f) => posesion === 'cualquiera' || (posesion === 'si' ? f.skus > 0 : f.skus === 0))
      .filter((f) => !negativo || f.negativos > 0)
      .filter((f) => conMovs === 'cualquiera' || (conMovs === 'si' ? f.movimientos > 0 : f.movimientos === 0))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [filas, busqueda, posesion, negativo, conMovs])

  const hayFiltro = bodegaId !== '' || materialId !== '' || posesion !== 'cualquiera' || negativo || conMovs !== 'cualquiera' || periodo !== 'todo' || busqueda !== ''
  const material = materiales.find((m) => m.id === materialId) ?? null
  const esInsumoElegido = esTipoInsumo(material?.tipo?.nombre)
  const selectCls = 'bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const alMaterial = material ? 'ese material' : 'material'

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">🔎 ¿A quién revisar?</h2>
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-72">
            <MaterialSelect materiales={materiales} value={materialId} onChange={setMaterialId} sinPaquetes
              placeholder="Todos los materiales (o elige uno)…" />
          </div>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre…"
            className={`${selectCls} w-36`} />
          <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className={selectCls} aria-label="Bodega de origen"
            title="De qué bodega recibió el material (según sus Entregas)">
            <option value="">Bodega de origen: cualquiera</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>Origen: {b.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={esInsumoElegido ? 'cualquiera' : posesion} disabled={esInsumoElegido} onChange={(e) => setPosesion(e.target.value as TriFiltro)} className={`${selectCls} disabled:opacity-50`} aria-label="Posesión"
            title={esInsumoElegido ? 'Los insumos no tienen posesión: solo se registra su entrega' : undefined}>
            <option value="cualquiera">En posesión: da igual</option>
            <option value="si">Tiene {alMaterial}</option>
            <option value="no">No tiene {alMaterial}</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={negativo} onChange={(e) => setNegativo(e.target.checked)} />
            Con stock negativo
          </label>
          <select value={conMovs} onChange={(e) => setConMovs(e.target.value as TriFiltro)} className={selectCls} aria-label="Movimientos">
            <option value="cualquiera">Movimientos: da igual</option>
            <option value="si">Con movimientos{material ? ' de ese material' : ''}</option>
            <option value="no">Sin movimientos{material ? ' de ese material' : ''}</option>
          </select>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoMov)} className={selectCls} aria-label="Período">
            <option value="todo">Todo el historial</option>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
          {hayFiltro && (
            <button type="button" className="text-xs text-slate-400 hover:text-white"
              onClick={() => { setBodegaId(''); setMaterialId(''); setPosesion('cualquiera'); setNegativo(false); setConMovs('cualquiera'); setPeriodo('todo'); setBusqueda('') }}>
              Quitar filtros
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="text-[11px] text-slate-400">
          {visibles === null ? 'Calculando…' : `Mostrando ${visibles.length} de ${trabajadores.length} trabajadores`}
          {material && <> · material: <span className="text-slate-300">{material.sku} — {material.apodo || material.descripcion}</span></>}
          {esInsumoElegido && <> · insumo: solo se registra la entrega</>}
        </p>
        {bodegaId && (
          <p className="text-[11px] text-slate-500">
            Origen {bodegas.find((b) => b.id === bodegaId)?.nombre}: solo cuenta lo que recibió de esa bodega
            (por lote, según sus Entregas); "Movimientos" son las Entregas desde ella.
          </p>
        )}
      </div>

      {visibles && visibles.length > 0 && (
        <div className="overflow-auto rounded-xl border border-slate-700 max-h-72">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-slate-900 text-slate-400 text-left divide-x divide-slate-700">
                <th className="px-2 py-1.5 font-medium">Trabajador</th>
                <th className="px-2 py-1.5 font-medium">Origen</th>
                <th className="px-2 py-1.5 font-medium text-right">{esInsumoElegido ? 'Entregado' : material ? 'Físico' : 'Materiales (SKU)'}</th>
                {material && !esInsumoElegido && <th className="px-2 py-1.5 font-medium text-right">Digital</th>}
                <th className="px-2 py-1.5 font-medium text-right">Negativos</th>
                <th className="px-2 py-1.5 font-medium text-right">Movimientos</th>
                <th className="px-2 py-1.5 font-medium">Último</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} onClick={() => onElegir(f.id)}
                  className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60 hover:bg-slate-700/60 cursor-pointer">
                  <td className="px-2 py-1.5 text-white whitespace-nowrap">{f.nombre}</td>
                  <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap" title="Bodega(s) de la que recibió lo que tiene en posesión">{f.origen || '—'}</td>
                  <td className="px-2 py-1.5 text-right text-slate-200 whitespace-nowrap">{esInsumoElegido ? f.entregado : material ? f.fisico : f.skus}</td>
                  {material && !esInsumoElegido && <td className="px-2 py-1.5 text-right text-slate-200 whitespace-nowrap">{f.digital}</td>}
                  <td className={`px-2 py-1.5 text-right whitespace-nowrap ${f.negativos > 0 ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>{f.negativos || '—'}</td>
                  <td className="px-2 py-1.5 text-right text-slate-200 whitespace-nowrap">{f.movimientos}</td>
                  <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{f.ultimo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {visibles && visibles.length === 0 && <p className="text-xs text-slate-500">Ningún trabajador cumple esos filtros.</p>}
    </div>
  )
}

/**
 * Rediseño pedido por Andrés ("la sección... es confusa"): en vez de un
 * libro contable agrupado por proyecto (que repetía el mismo material en
 * varias filas si se usó en más de un proyecto), va en el orden que pidió:
 * advertencias → trabajador → lo que tiene en posesión ahora (stock real,
 * no un cálculo aparte) → movimientos de/hacia él, con el saldo que quedó
 * después de cada uno.
 */
function TecnicoTab() {
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [userId, setUserId] = useState('')
  const [ubicacionesTecnico, setUbicacionesTecnico] = useState<Ubicacion[]>([])
  const [posesion, setPosesion] = useState<StockRow[] | null>(null)
  const [movimientos, setMovimientos] = useState<Movimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Eventos de instalación forzada (stock negativo) de CUALQUIER técnico —
  // no depende de cuál esté elegido en el selector de abajo (sujeto a
  // revisarse: por ahora es una advertencia global, no por trabajador).
  // Separados de los de Conteo (origen bodega), que se resuelven aparte.
  const [eventos, setEventos] = useState<EventoInventario[] | null>(null)
  const detalleRef = useRef<HTMLDivElement>(null)

  async function reloadEventos() {
    try {
      const evs = await listEventosInventario({ estado: 'abierto' })
      setEventos(evs.filter((e) => e.ubicacionTipo === 'tecnico'))
    } catch (err) {
      console.error('[TecnicoTab] listEventosInventario:', err)
    }
  }
  useEffect(() => { reloadEventos() }, [])

  useEffect(() => {
    adminRepo.listProfiles()
      .then((all) => {
        // Cualquier trabajador activo, sin importar su rol — cualquiera
        // puede tener stock propio a su nombre (ver AsignacionesForm.tsx).
        const cs = all.filter((p) => p.activo)
        setTecnicos(cs)
        if (cs.length > 0) setUserId(cs[0].id)
      })
      .catch(() => {})
    listUbicaciones({ tipo: 'tecnico' }).then(setUbicacionesTecnico).catch(() => {})
  }, [])

  // La ubicación personal del trabajador se crea recién al primer
  // movimiento (`ensure_ubicacion_tecnico`) — si nunca tuvo uno, no existe
  // todavía y no hay nada en posesión que consultar.
  const tecnicoUbicacionId = ubicacionesTecnico.find((u) => u.ownerUserId === userId)?.id ?? null

  useEffect(() => {
    if (!userId) return
    setError(null)
    if (tecnicoUbicacionId) {
      setPosesion(null)
      getStock({ ubicacionId: tecnicoUbicacionId }).then(setPosesion).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    } else {
      setPosesion([])
    }
    setMovimientos(null)
    listMovimientos({ usuarioId: userId, tipos: [...TIPOS_TECNICO], limit: null })
      .then(setMovimientos)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [userId, tecnicoUbicacionId])

  // Los insumos solo se entregan: no aparecen como "en posesión" (sí sus entregas, abajo).
  const [insumoIds, setInsumoIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    listMateriales().then((ms) => setInsumoIds(new Set(ms.filter((m) => esTipoInsumo(m.tipo?.nombre)).map((m) => m.id)))).catch(() => {})
  }, [])
  const enPosesion = useMemo(
    () => (posesion ?? []).filter((r) => !insumoIds.has(r.materialId) && (r.cantidadFisico !== 0 || r.cantidadDigital !== 0)),
    [posesion, insumoIds])

  // `listMovimientos` ya viene más reciente primero (fecha desc, created_at
  // desc) — se recorre al revés para acumular el saldo en orden cronológico
  // real, y se vuelve a invertir para mostrar arriba lo más reciente, con el
  // saldo que quedó justo después de ese movimiento. Por material+lote —
  // el saldo es el stock físico real del trabajador (verificado exacto
  // contra `getStock` de la misma ubicación), no depende de a qué proyecto
  // se le haya atribuido.
  const movimientosConSaldo = useMemo(() => {
    if (!movimientos) return null
    const saldoPorClave = new Map<string, number>()
    const conSaldo = [...movimientos].reverse().map((m) => {
      const clave = `${m.materialId}|${m.lote}`
      // Un insumo no lleva saldo: solo queda el registro de la entrega.
      const impacto = insumoIds.has(m.materialId) ? 0 : impactoParaTecnico(m, tecnicoUbicacionId)
      const saldo = (saldoPorClave.get(clave) ?? 0) + impacto
      saldoPorClave.set(clave, saldo)
      return { mov: m, saldo, impacto }
    })
    return conSaldo.reverse()
  }, [movimientos, tecnicoUbicacionId, insumoIds])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2">⚠️ Advertencias</h2>
        {eventos && eventos.length > 0 ? (
          <EventosAbiertosSection eventos={eventos} onResolved={reloadEventos} />
        ) : (
          <p className="text-xs text-slate-500">Sin advertencias pendientes.</p>
        )}
      </div>

      {tecnicos.length === 0 ? (
        <p className="text-xs text-slate-500">No hay trabajadores registrados.</p>
      ) : (
        <>
          <BuscadorTrabajadores trabajadores={tecnicos} onElegir={(id) => {
            setUserId(id)
            setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          }} />

          <div ref={detalleRef} className="scroll-mt-4">
            <label className="block text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2">Trabajador</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${inputCls} w-full`}>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre?.trim() || t.email}</option>)}
            </select>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div>
            <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2">📦 Material actualmente en posesión</h2>
            {enPosesion === null ? (
              <p className="text-xs text-slate-500">Cargando…</p>
            ) : enPosesion.length === 0 ? (
              <p className="text-xs text-slate-500">No tiene material en posesión.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium">Material</th>
                      <th className="px-2 py-1.5 font-medium">Lote</th>
                      <th className="px-2 py-1.5 font-medium text-right">Físico</th>
                      <th className="px-2 py-1.5 font-medium text-right">Digital</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enPosesion.map((r) => (
                      <tr key={`${r.materialId}|${r.lote}`} className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
                        <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.materialSku}</td>
                        <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{r.materialDescripcion}</p></td>
                        <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{r.lote}</td>
                        <td className="px-2 py-2 text-right text-white font-semibold whitespace-nowrap">{r.cantidadFisico}</td>
                        <td className="px-2 py-2 text-right text-white font-semibold whitespace-nowrap">{r.cantidadDigital}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide mb-2">📜 Movimientos desde/hacia el trabajador</h2>
            {movimientosConSaldo === null ? (
              <p className="text-xs text-slate-500">Cargando…</p>
            ) : movimientosConSaldo.length === 0 ? (
              <p className="text-xs text-slate-500">Sin movimientos.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                      <th className="px-2 py-1.5 font-medium">Fecha</th>
                      <th className="px-2 py-1.5 font-medium">Tipo</th>
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium">Material</th>
                      <th className="px-2 py-1.5 font-medium">Lote</th>
                      <th className="px-2 py-1.5 font-medium text-right">Cantidad</th>
                      <th className="px-2 py-1.5 font-medium text-right">Saldo después</th>
                      <th className="px-2 py-1.5 font-medium">Proyecto</th>
                      <th className="px-2 py-1.5 font-medium">Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientosConSaldo.map(({ mov: m, saldo, impacto }) => {
                      const titulo = impacto === 0
                        ? (m.tipo === 'rebaja' ? 'Ajusta el digital de la bodega, no el stock del trabajador'
                          : m.tipo === 'instalado' ? 'Se tomó del stock de otro compañero de proyecto — no afecta el suyo'
                          : m.tipo === 'solicitud' ? 'Registro previo al instalado — todavía no toca stock'
                          : 'No mueve stock — reasignación contable al cerrar el proyecto')
                        : undefined
                      return (
                        <tr key={m.id} className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
                          <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.fecha.slice(0, 10)}</td>
                          <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{TIPO_LABELS_MOV[m.tipo] ?? m.tipo}</td>
                          <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.materialSku}</td>
                          <td className="px-2 py-2 max-w-[200px]"><p className="text-white truncate">{m.materialDescripcion}</p></td>
                          <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.lote}</td>
                          <td className={`px-2 py-2 text-right font-semibold whitespace-nowrap ${impacto > 0 ? 'text-green-400' : impacto < 0 ? 'text-red-400' : 'text-slate-500'}`}
                            title={insumoIds.has(m.materialId) ? 'Insumo: solo se registra la entrega, sin saldo' : titulo}>
                            {insumoIds.has(m.materialId) ? '' : impacto > 0 ? '+' : impacto < 0 ? '−' : '±'}{m.cantidad}
                          </td>
                          <td className="px-2 py-2 text-right text-white font-semibold whitespace-nowrap">{insumoIds.has(m.materialId) ? '—' : saldo}</td>
                          <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                            {m.projectOtt ? `[${m.area === 'ATT' ? 'ATT' : 'Preventivo'}] ${m.projectOtt}` : SIN_PROYECTO_TEC}
                          </td>
                          <td className="px-2 py-2 max-w-[200px]"><p className="text-slate-400 truncate">{m.nota ?? '—'}</p></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ConteoTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Bodegas y técnicos se cuentan por separado (mezclados confundían). El
  // segmento vive acá, no en la lista, para que al volver de un conteo se
  // quede en el mismo.
  const [segmento, setSegmento] = useState<UbicacionTipo>('bodega')

  if (selectedId) {
    return <ConteoDetail conteoId={selectedId} onBack={() => { setSelectedId(null); setRefreshKey((k) => k + 1) }} />
  }
  return <ConteoLista onSelect={setSelectedId} refreshKey={refreshKey} segmento={segmento} onSegmento={setSegmento} />
}

function ConteoLista({ onSelect, refreshKey, segmento, onSegmento }: {
  onSelect: (id: string) => void; refreshKey: number; segmento: UbicacionTipo; onSegmento: (s: UbicacionTipo) => void
}) {
  const [conteos, setConteos] = useState<Conteo[] | null>(null)
  // Todos los estados (no solo 'abierto' como antes) — hace falta el total
  // para el contador "Eventos resueltos: X/Y" de abajo. Andrés: en vez de
  // una pantalla nueva de historial, basta con dejar los eventos dentro de
  // Conteo y mostrar ese resumen afuera, en esta misma vista de selección.
  const [eventosTodos, setEventosTodos] = useState<EventoInventario[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNuevo, setShowNuevo] = useState(false)

  async function reload() {
    try {
      const [cs, evs] = await Promise.all([listConteos(), listEventosInventario()])
      setConteos(cs)
      // Los de técnico (instalación forzada) se resuelven en la pestaña
      // Técnico — acá solo quedan los de origen bodega (Conteo).
      setEventosTodos(evs.filter((e) => e.ubicacionTipo !== 'tecnico'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey])

  const eventosAbiertos = eventosTodos?.filter((e) => e.estado === 'abierto') ?? []
  const resueltosCount = eventosTodos?.filter((e) => e.estado === 'resuelto').length ?? 0

  const esBodegas = segmento === 'bodega'
  const delSegmento = (conteos ?? []).filter((c) => c.ubicacionTipo === segmento)
  const cuenta = (tipo: UbicacionTipo) => (conteos ?? []).filter((c) => c.ubicacionTipo === tipo).length
  const segBtn = (tipo: UbicacionTipo, etiqueta: string) => (
    <button type="button" onClick={() => { onSegmento(tipo); setShowNuevo(false) }}
      className={`flex-1 text-sm font-semibold py-1.5 rounded-lg ${segmento === tipo ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
      {etiqueta} ({cuenta(tipo)})
    </button>
  )

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        {segBtn('bodega', 'Bodegas')}
        {segBtn('tecnico', 'Técnicos')}
      </div>

      {/* Las diferencias de los conteos de técnicos (y las instalaciones forzadas) se resuelven en Stock → Técnico. */}
      {esBodegas && eventosTodos && (
        <p className="text-[11px] text-slate-500">
          Eventos resueltos: <span className="text-slate-300 font-medium">{resueltosCount}/{eventosTodos.length}</span>
        </p>
      )}

      {esBodegas && eventosAbiertos.length > 0 && <EventosAbiertosSection eventos={eventosAbiertos} onVerConteo={onSelect} onResolved={reload} />}

      <button type="button" onClick={() => setShowNuevo((v) => !v)}
        className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white">
        {showNuevo ? 'Cancelar' : esBodegas ? '+ Nuevo conteo de bodega' : '+ Nuevo conteo de técnico'}
      </button>
      {showNuevo && <NuevoConteoForm tipo={segmento} onCreated={(id) => { setShowNuevo(false); onSelect(id) }} />}

      {conteos === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : delSegmento.length === 0 ? (
        <p className="text-xs text-slate-500">{esBodegas ? 'Sin conteos de bodegas todavía.' : 'Sin conteos de técnicos todavía.'}</p>
      ) : (
        <div className="space-y-1.5">
          {delSegmento.map((c) => (
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

function NuevoConteoForm({ tipo, onCreated }: { tipo: UbicacionTipo; onCreated: (id: string) => void }) {
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
      <UbicacionSelect value={ubicacionId} onChange={setUbicacionId} tipo={tipo}
        placeholder={tipo === 'bodega' ? 'Elegir bodega…' : 'Elegir técnico…'} className={`${inputCls} w-full`} />
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
  agregar: 'Agregar', ignorar: 'Reconocida',
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
      <p className="text-sm font-semibold text-amber-300">⚠️ {eventos.length} diferencia(s) por reconocer</p>
      <FiltroYCierreEventos eventos={eventos} onResolved={onResolved}>
        {(filtrados) => (
          <div className="space-y-1.5">
            {filtrados.map((e) => (
              <EventoCard key={e.id} evento={e} onResolved={onResolved} onVerConteo={onVerConteo} mostrarUbicacion />
            ))}
          </div>
        )}
      </FiltroYCierreEventos>
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
  const abiertos = eventos.filter((e) => e.estado === 'abierto')
  const resueltos = eventos.filter((e) => e.estado !== 'abierto')
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-white">Eventos de este conteo</p>
      {abiertos.length > 0 && (
        <FiltroYCierreEventos eventos={abiertos} onResolved={onResolved}>
          {(filtrados) => <div className="space-y-2">{filtrados.map((e) => <EventoCard key={e.id} evento={e} onResolved={onResolved} />)}</div>}
        </FiltroYCierreEventos>
      )}
      {resueltos.map((e) => <EventoCard key={e.id} evento={e} onResolved={onResolved} />)}
    </div>
  )
}

type SignoFiltro = 'todas' | 'faltantes' | 'sobrantes'

/**
 * Filtros de las diferencias abiertas (por ubicación —bodega o técnico—, por
 * signo de la diferencia y por stock negativo) y cierre masivo de las que
 * quedan a la vista: se reconocen todas con la misma causa. Cada una conserva
 * su registro (resolución + causa) y el stock no cambia — ver
 * `reconocerEventos` en inventarioRepo.
 */
function FiltroYCierreEventos({ eventos, onResolved, children }: {
  eventos: EventoInventario[]
  onResolved: () => void
  children: (filtrados: EventoInventario[]) => ReactNode
}) {
  const [ubicacionId, setUbicacionId] = useState('')
  const [signo, setSigno] = useState<SignoFiltro>('todas')
  const [soloNegativo, setSoloNegativo] = useState(false)
  const [negativos, setNegativos] = useState<Set<string> | null>(null)
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [causa, setCausa] = useState('')
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!soloNegativo || negativos !== null) return
    listClavesStockNegativo().then(setNegativos).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
      setSoloNegativo(false)
    })
  }, [soloNegativo, negativos])

  const ubicaciones = useMemo(() => {
    const porId = new Map<string, { id: string; nombre: string; tipo: 'bodega' | 'tecnico'; n: number }>()
    for (const e of eventos) {
      const u = porId.get(e.ubicacionId)
      if (u) u.n += 1
      else porId.set(e.ubicacionId, { id: e.ubicacionId, nombre: e.ubicacionNombre, tipo: e.ubicacionTipo, n: 1 })
    }
    return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [eventos])

  // Si tras cerrar ya no quedan eventos de la ubicación elegida, vuelve a "Todas".
  const ubicacionActiva = ubicaciones.some((u) => u.id === ubicacionId) ? ubicacionId : ''

  const filtrados = useMemo(() => eventos.filter((e) => {
    if (ubicacionActiva && e.ubicacionId !== ubicacionActiva) return false
    if (signo === 'faltantes' && !(e.diferencia < 0)) return false
    if (signo === 'sobrantes' && !(e.diferencia > 0)) return false
    if (soloNegativo && !(negativos?.has(`${e.ubicacionId}|${e.materialId}|${e.lote}`))) return false
    return true
  }), [eventos, ubicacionActiva, signo, soloNegativo, negativos])

  const hayFiltro = ubicacionActiva !== '' || signo !== 'todas' || soloNegativo
  const cargandoNegativos = soloNegativo && negativos === null
  const selectCls = 'bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const busy = progreso !== null

  async function cerrarTodos() {
    const lista = filtrados
      .map((e) => ({ id: e.id, restante: Math.abs(e.diferencia) - e.cantidadResuelta }))
      .filter((e) => e.restante > 0)
    if (lista.length === 0) return
    if (!causa.trim()) { setError('Escribe la causa de la diferencia'); return }
    if (!confirm(`¿Reconocer ${lista.length} diferencia(s) con esta causa?\n\n"${causa.trim()}"\n\nCada una queda registrada con su causa (no se borra) y el stock no cambia.`)) return
    setError(null)
    setProgreso({ hechos: 0, total: lista.length })
    try {
      const r = await reconocerEventos(lista, causa.trim(), (hechos) => setProgreso({ hechos, total: lista.length }))
      setProgreso(null)
      setCausa('')
      setPanelAbierto(false)
      setNegativos(null)
      if (r.fallidos.length > 0) {
        alert(`Se reconocieron ${r.ok} y fallaron ${r.fallidos.length}. Primer error: ${r.fallidos[0].error}`)
      }
      onResolved()
    } catch (err) {
      setProgreso(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-2">
      {eventos.length > 1 && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={ubicacionActiva} onChange={(e) => setUbicacionId(e.target.value)} className={selectCls} aria-label="Ubicación">
              <option value="">Todas las ubicaciones</option>
              {(['bodega', 'tecnico'] as const).map((tipo) => {
                const lista = ubicaciones.filter((u) => u.tipo === tipo)
                return lista.length === 0 ? null : (
                  <optgroup key={tipo} label={tipo === 'bodega' ? 'Bodegas' : 'Técnicos'}>
                    {lista.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.n})</option>)}
                  </optgroup>
                )
              })}
            </select>
            <select value={signo} onChange={(e) => setSigno(e.target.value as SignoFiltro)} className={selectCls} aria-label="Diferencia">
              <option value="todas">Faltantes y sobrantes</option>
              <option value="faltantes">Solo faltantes (−)</option>
              <option value="sobrantes">Solo sobrantes (+)</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={soloNegativo} onChange={(e) => setSoloNegativo(e.target.checked)} />
              Solo con stock negativo ahora
            </label>
            {hayFiltro && (
              <button type="button" onClick={() => { setUbicacionId(''); setSigno('todas'); setSoloNegativo(false) }}
                className="text-xs text-slate-400 hover:text-white">Quitar filtros</button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">
              {cargandoNegativos ? 'Buscando stock negativo…' : `Mostrando ${filtrados.length} de ${eventos.length}`}
            </p>
            {!panelAbierto && (
              <button type="button" disabled={filtrados.length === 0 || cargandoNegativos}
                onClick={() => { setError(null); setPanelAbierto(true) }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white">
                {hayFiltro ? `Reconocer los ${filtrados.length} filtrados…` : `Reconocer todos (${filtrados.length})…`}
              </button>
            )}
          </div>

          {panelAbierto && (
            <div className="bg-slate-700/50 rounded-xl p-3 space-y-2">
              <p className="text-[11px] text-slate-400 italic">
                Se reconocen las {filtrados.length} diferencia(s) a la vista con la misma causa. Cada una queda registrada
                (no se borra) y el stock no cambia.
              </p>
              <input value={causa} onChange={(e) => setCausa(e.target.value)} disabled={busy}
                onKeyDown={(e) => { if (e.key === 'Enter') cerrarTodos() }}
                placeholder="Causa de las diferencias (obligatoria)"
                className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2 items-center">
                <button type="button" onClick={cerrarTodos} disabled={busy}
                  className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
                  {busy ? `Reconociendo ${progreso!.hechos}/${progreso!.total}…` : `Reconocer ${filtrados.length}`}
                </button>
                <button type="button" onClick={() => setPanelAbierto(false)} disabled={busy} className="text-xs text-slate-400 px-2">Cancelar</button>
              </div>
            </div>
          )}
          {!panelAbierto && error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {children(filtrados)}
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
          <ReconocerEventoForm evento={evento} restante={restante}
            onDone={() => { setShowForm(false); onResolved() }} onCancel={() => setShowForm(false)} />
        ) : (
          <button type="button" onClick={() => setShowForm(true)} className="text-xs text-amber-400 font-semibold">
            Reconocer y dejar la causa →
          </button>
        )
      )}
    </div>
  )
}

function ResolucionRow({ r }: { r: EventoResolucion }) {
  // Las diferencias nuevas solo se reconocen ('ignorar' por dentro): se muestra la causa.
  // Las resoluciones antiguas (consumo, devolución, etc.) siguen mostrándose como estaban.
  if (r.tipo === 'ignorar') {
    return (
      <p className="text-[11px] text-slate-400">
        <span className="text-slate-300 font-medium">Reconocida</span> · {r.cantidad}
        {' · '}<span className="italic">{r.nota ? `Causa: ${r.nota}` : 'Sin causa anotada'}</span>
      </p>
    )
  }
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

/**
 * Una diferencia de Conteo (o una instalación forzada de técnico) ya no se
 * "resuelve" de varias formas: solo se RECONOCE y se deja la causa en una
 * nota (decisión de Andrés, 05-10). No mueve stock — el número que dejó el
 * conteo queda como el stock actual. Por dentro es la resolución 'ignorar'
 * (0061) por todo lo que falta, con nota obligatoria; no hace falta migración.
 */
function ReconocerEventoForm({ evento, restante, onDone, onCancel }: {
  evento: EventoInventario; restante: number; onDone: () => void; onCancel: () => void
}) {
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!nota.trim()) { setError('Escribe la causa de la diferencia'); return }
    setBusy(true)
    setError(null)
    try {
      await resolverEvento(evento.id, { tipo: 'ignorar', cantidad: restante, nota: nota.trim() })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-slate-700/50 rounded-xl p-3 space-y-2">
      <p className="text-[11px] text-slate-400 italic">
        No mueve stock: el número que dejó {evento.conteoId ? 'el conteo' : 'la instalación'} queda como el stock actual.
        Solo se deja constancia de la causa de la diferencia ({evento.diferencia > 0 ? '+' : ''}{evento.diferencia}).
      </p>
      <input value={nota} onChange={(e) => setNota(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        placeholder="Causa de la diferencia (obligatoria)"
        className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
          {busy ? 'Guardando…' : 'Reconocer'}
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

/** Milisegundos sin nuevas pulsaciones antes de guardar solo — mismo valor que el autoguardado de ATT/Preventivos/Incidencias. */
const DEBOUNCE_CONTEO_MS = 800

function ConteoLineaFila({ linea, editable, onSaved, onPendienteChange }: {
  linea: ConteoLinea; editable: boolean; onSaved: () => void; onPendienteChange: (pendiente: boolean) => void
}) {
  const [draft, setDraft] = useState(String(linea.cantidadContada))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cerrado: la diferencia sale de lo persistido, no del draft local (que
  // puede quedar obsoleto si el guardado nunca ocurrió).
  const diferencia = (editable ? Number(draft || 0) : linea.cantidadContada) - linea.cantidadSistema
  const dirty = editable && draft.trim() !== '' && Number(draft) !== linea.cantidadContada

  useEffect(() => { onPendienteChange(dirty || status === 'saving') }, [dirty, status, onPendienteChange])
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])
  // Si la línea no se vuelve a montar (mismo `key={l.id}` en la tabla), este
  // `useState` inicial no se re-ejecuta solo — sin esto, una cantidad que
  // cambia por fuera (ej. un import de Excel que actualiza una línea ya
  // existente) queda pisada por el draft viejo hasta recargar la página.
  // Solo se sincroniza si no hay una edición local en curso, para no pisar lo
  // que el usuario está tipeando si un import corre justo en paralelo.
  useEffect(() => {
    if (debounceRef.current || status === 'saving') return
    setDraft(String(linea.cantidadContada))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linea.cantidadContada])

  async function save(n: number) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setStatus('saving')
    try {
      await actualizarLineaConteo(linea.id, n)
      setStatus('saved')
      onSaved()
    } catch (err) {
      setStatus('error')
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  // Se guarda solo, sin que haya que confirmar cada línea a mano — el pedido
  // explícito de Andrés fue sacar ese paso ("es confuso y suma pasos
  // innecesarios"), dejando solo un indicador de que se guardó. Debounce en
  // vez de solo onBlur: antes dependía de un botón aparte porque en varios
  // celulares el teclado numérico no dispara blur al "tocar fuera" (o lo tapa
  // toda la pantalla) — con el guardado disparándose solo tras una pausa al
  // tipear, ese caso queda cubierto igual, sin depender del blur.
  function onChange(value: string) {
    setDraft(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const n = Number(value)
    if (value.trim() === '' || Number.isNaN(n) || n === linea.cantidadContada) return
    debounceRef.current = setTimeout(() => save(n), DEBOUNCE_CONTEO_MS)
  }

  function onBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const n = Number(draft)
    if (draft.trim() === '' || Number.isNaN(n) || n === linea.cantidadContada) return
    save(n)
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
            <input type="number" step="any" value={draft} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className={`w-20 bg-slate-700 text-white text-sm rounded-lg px-2 py-1 border text-right focus:outline-none ${
                status === 'error' ? 'border-red-500' : (dirty || status === 'saving') ? 'border-amber-500' : 'border-slate-600 focus:border-brand-500'
              }`} />
            {/* Solo indicador — no hay nada que tocar ni confirmar a mano. */}
            <span className="w-5 h-5 flex items-center justify-center shrink-0"
              title={status === 'saving' ? 'Guardando…' : status === 'saved' ? 'Guardado' : status === 'error' ? 'Error al guardar' : undefined}>
              {status === 'saving' && <span className="text-sm animate-spin">⏳</span>}
              {status === 'saved' && <span className="text-green-400 text-sm">✓</span>}
              {status === 'error' && <span className="text-red-400 text-sm">⚠</span>}
            </span>
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
        Cargar conteo desde Excel SAP — columnas Material/Texto breve de material/Lote/Libre utilización; el resto se ignora. Lo que ya estaba en el conteo y no venga en este archivo queda en 0 (el lote puede haber dejado de existir en SAP). Arrastra el .xlsx aquí o:
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
          {resultado.materialesCreados > 0 ? `, ${resultado.materialesCreados} material(es) nuevo(s)` : ''}
          {resultado.lineasEnCero > 0 ? `, ${resultado.lineasEnCero} puesta(s) en 0 (no vinieron en este archivo)` : ''}.
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
  const [paquetes, setPaquetes] = useState<Paquete[] | null>(null)
  const [codigosLpu, setCodigosLpu] = useState<LpuCodigo[] | null>(null)
  const [mapeosLpu, setMapeosLpu] = useState<Map<string, LpuMaterialMap[]>>(new Map())
  const [materialLpuId, setMaterialLpuId] = useState('')
  const [soloSinLpu, setSoloSinLpu] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const editorLpuRef = useRef<HTMLDivElement>(null)

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
  useEffect(() => { listPaquetes().then(setPaquetes).catch((err) => setError(err instanceof Error ? err.message : String(err))) }, [])
  useEffect(() => { listLpuCodigos().then(setCodigosLpu).catch((err) => setError(err instanceof Error ? err.message : String(err))) }, [])
  function recargarMapeosLpu() {
    listLpuMaterialMapTodos().then(setMapeosLpu).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }
  useEffect(recargarMapeosLpu, [])

  function editarLpu(materialId: string) {
    setMaterialLpuId(materialId)
    // El editor está bajo la tabla: se lleva la vista hasta él.
    setTimeout(() => editorLpuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const filtrados = useMemo(() => {
    if (!materiales) return null
    const query = q.trim().toLowerCase()
    const base = soloSinLpu ? materiales.filter((m) => !(mapeosLpu.get(m.id) ?? []).some((x) => x.activo)) : materiales
    if (!query) return base
    return base.filter((m) =>
      m.sku.toLowerCase().includes(query) ||
      m.descripcion.toLowerCase().includes(query) ||
      (m.apodo ?? '').toLowerCase().includes(query))
  }, [materiales, q, soloSinLpu, mapeosLpu])

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

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, descripción o nombre alternativo…"
          className={`${inputCls} flex-1 min-w-[14rem]`} />
        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer shrink-0">
          <input type="checkbox" checked={soloSinLpu} onChange={(e) => setSoloSinLpu(e.target.checked)} />
          Solo sin LPU
        </label>
      </div>

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
                <th className="px-2 py-1.5">LPU (Estado de Pago)</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-500">Sin coincidencias.</td></tr>
              )}
              {filtrados.map((m) => (
                <FilaCatalogoMaterial key={m.id} material={m} tipos={tipos} proveedoresCatalogo={proveedoresCatalogo}
                  mapeosLpu={mapeosLpu.get(m.id) ?? []} onEditarLpu={() => editarLpu(m.id)}
                  onApodoChange={(apodo) => actualizarLocal(m.id, { apodo })}
                  onDescripcionChange={(descripcion) => actualizarLocal(m.id, { descripcion })}
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
          <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Paquetes de materiales</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Grupos de SKU que casi siempre se ingresan juntos (ej. "Kit cruceta 6 piezas"). Aparecen al final de
            cualquier buscador de material — elegir uno agrega todos sus SKU de una vez, sin cantidad (se completa a
            mano por línea, igual que agregándolos uno por uno).
          </p>
        </div>
        {!materiales || !paquetes ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : (
          <PaquetesSection materiales={materiales} paquetes={paquetes} onChange={setPaquetes} onError={setError} />
        )}
      </div>

      <div ref={editorLpuRef} className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3 scroll-mt-4">
        <div>
          <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material → Código LPU</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Qué línea(s) del Estado de Pago genera cada material instalado (ej. mufa → confección + fusión). El cable
            también es un material: su cantidad instalada (metros) se cobra con el código que le asignes acá, y su
            tipo de tendido sale de este mismo editor. Cantidad de la línea = instalado × factor.
          </p>
        </div>
        {!materiales || !codigosLpu ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : (
          <LpuMaterialMapEditor materiales={materiales} codigos={codigosLpu}
            materialId={materialLpuId} onMaterialChange={setMaterialLpuId}
            onMapeosChange={recargarMapeosLpu}
            onTendidoSaved={(id, tipoTendido) => actualizarLocal(id, { tipoTendido })} />
        )}
      </div>
    </div>
  )
}

function PaquetesSection({ materiales, paquetes, onChange, onError }: {
  materiales: Material[]
  paquetes: Paquete[]
  onChange: (paquetes: Paquete[]) => void
  onError: (msg: string) => void
}) {
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [creando, setCreando] = useState(false)

  async function crear() {
    if (!nombreNuevo.trim()) return
    setCreando(true)
    try {
      const nuevo = await crearPaquete(nombreNuevo)
      onChange([...paquetes, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setNombreNuevo('')
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreando(false)
    }
  }

  async function borrar(paquete: Paquete) {
    if (!confirm(`¿Eliminar el paquete "${paquete.nombre}"? No borra los SKU, solo el agrupamiento.`)) return
    try {
      await eliminarPaquete(paquete.id)
      onChange(paquetes.filter((p) => p.id !== paquete.id))
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function actualizarMateriales(paquete: Paquete, materialIds: string[]) {
    // Optimista: la sección de abajo (MaterialSelect) depende de que
    // `paquetes` refleje el cambio al toque para no ofrecer agregar el mismo
    // SKU dos veces.
    onChange(paquetes.map((p) => (p.id === paquete.id ? { ...p, materialIds } : p)))
    try {
      await updatePaqueteMateriales(paquete.id, materialIds)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
      onChange(paquetes) // revierte si falló
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Nombre del paquete nuevo…"
          onKeyDown={(e) => e.key === 'Enter' && crear()}
          className={`${inputCls} flex-1`} />
        <button type="button" onClick={crear} disabled={creando || !nombreNuevo.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white shrink-0">
          {creando ? 'Creando…' : '+ Nuevo paquete'}
        </button>
      </div>

      {paquetes.length === 0 && <p className="text-xs text-slate-500">Sin paquetes todavía.</p>}

      {paquetes.map((paquete) => (
        <div key={paquete.id} className="bg-slate-900/40 rounded-xl border border-slate-700 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">📦 {paquete.nombre}</p>
            <button type="button" onClick={() => borrar(paquete)} className="text-[10px] text-red-400 hover:text-red-300 shrink-0">
              Eliminar paquete
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {paquete.materialIds.map((materialId) => {
              const m = materiales.find((mm) => mm.id === materialId)
              return (
                <span key={materialId} className="inline-flex items-center gap-1 bg-slate-700 text-slate-200 text-[11px] rounded-full px-2 py-1">
                  {m ? `${m.sku} — ${m.apodo || m.descripcion}` : materialId}
                  <button type="button" onClick={() => actualizarMateriales(paquete, paquete.materialIds.filter((id) => id !== materialId))}
                    className="text-slate-400 hover:text-white">✕</button>
                </span>
              )
            })}
            {paquete.materialIds.length === 0 && <span className="text-[11px] text-slate-500">Sin SKU todavía.</span>}
          </div>
          <MaterialSelect materiales={materiales.filter((m) => !paquete.materialIds.includes(m.id))} value=""
            sinPaquetes placeholder="+ Agregar SKU a este paquete…"
            onChange={(id) => actualizarMateriales(paquete, [...paquete.materialIds, id])}
            className="w-full max-w-xs" />
        </div>
      ))}
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

function FilaCatalogoMaterial({ material, tipos, proveedoresCatalogo, mapeosLpu, onEditarLpu, onApodoChange, onDescripcionChange, onMinimoSaved, onTipoChange, onNuevoTipo, onNuevoProveedor, onProveedoresChange }: {
  material: Material
  tipos: MaterialTipo[]
  proveedoresCatalogo: Proveedor[]
  mapeosLpu: LpuMaterialMap[]
  onEditarLpu: () => void
  onApodoChange: (apodo: string | null) => void
  onDescripcionChange: (descripcion: string) => void
  onMinimoSaved: () => void
  onTipoChange: (tipoId: string) => void
  onNuevoTipo: (nombre: string) => void
  onNuevoProveedor: (nombre: string) => Promise<Proveedor>
  onProveedoresChange: (proveedores: Proveedor[]) => void
}) {
  const [apodo, setApodo] = useState(material.apodo ?? '')
  const [descripcion, setDescripcion] = useState(material.descripcion)
  const [errorDescripcion, setErrorDescripcion] = useState<string | null>(null)
  const [creandoTipo, setCreandoTipo] = useState(false)
  const [nombreNuevoTipo, setNombreNuevoTipo] = useState('')

  useEffect(() => { setApodo(material.apodo ?? '') }, [material.apodo])
  useEffect(() => { setDescripcion(material.descripcion) }, [material.descripcion])

  async function guardarApodo() {
    const valor = apodo.trim()
    if (valor === (material.apodo ?? '')) return
    await updateMaterialApodo(material.id, valor || null)
    onApodoChange(valor || null)
  }

  async function guardarDescripcion() {
    const valor = descripcion.trim()
    if (valor === material.descripcion) return
    // Vacía no se acepta: es lo que identifica al material en todas las demás
    // tablas. Se revierte a lo guardado en vez de dejar la celda en blanco.
    if (!valor) {
      setDescripcion(material.descripcion)
      setErrorDescripcion(null)
      return
    }
    setErrorDescripcion(null)
    try {
      await updateMaterialDescripcion(material.id, valor)
      onDescripcionChange(valor)
    } catch (err) {
      setErrorDescripcion(err instanceof Error ? err.message : String(err))
      setDescripcion(material.descripcion)
    }
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
      <td className="px-2 py-1.5">
        {/* Editable desde v1.54: la descripción SAP llega por import y un typo
            quedaba fijo para siempre. Es la que se ve en todas las tablas. */}
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} onBlur={guardarDescripcion}
          className="w-full min-w-[14rem] bg-slate-700 text-white rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        {errorDescripcion && <p className="text-[10px] text-red-400 mt-0.5">{errorDescripcion}</p>}
      </td>
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
      <td className="px-2 py-1.5">
        {/* Solo lectura acá — el clic lleva al editor "Material → Código LPU" con este material elegido. */}
        <button type="button" onClick={onEditarLpu} title="Editar los códigos LPU de este material"
          className="w-full text-left rounded px-1.5 py-1 hover:bg-slate-700 min-w-[8rem]">
          {mapeosLpu.length === 0 ? (
            <span className="text-amber-400/80">Sin LPU</span>
          ) : (
            mapeosLpu.map((x) => (
              <span key={x.id} className={`block whitespace-nowrap ${x.activo ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
                {x.lpuCodigo?.codigoAtt ?? '?'}{x.factorCantidad !== 1 ? <span className="text-slate-500"> ×{x.factorCantidad}</span> : null}
              </span>
            ))
          )}
          {material.tipoTendido && <span className="block text-[10px] text-slate-500">tendido: {material.tipoTendido}</span>}
        </button>
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

function LpuMaterialMapEditor({ materiales, codigos, materialId, onMaterialChange, onMapeosChange, onTendidoSaved }: {
  materiales: Material[]
  codigos: LpuCodigo[]
  materialId: string
  onMaterialChange: (id: string) => void
  onMapeosChange: () => void
  onTendidoSaved: (materialId: string, tipoTendido: string | null) => void
}) {
  const setMaterialId = onMaterialChange
  const material = materiales.find((m) => m.id === materialId) ?? null

  const [tipoTendido, setTipoTendido] = useState('')
  const [savingTendido, setSavingTendido] = useState(false)
  const [tendidoMsg, setTendidoMsg] = useState<string | null>(null)

  const [mapas, setMapas] = useState<LpuMaterialMap[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nuevoCodigoId, setNuevoCodigoId] = useState('')
  const [nuevoFactor, setNuevoFactor] = useState('1')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTendidoMsg(null)
    if (!material) { setTipoTendido(''); setMapas(null); return }
    setTipoTendido(material.tipoTendido ?? '')
    reload(material.id)
  }, [materialId]) // eslint-disable-line react-hooks/exhaustive-deps

  function reload(id: string) {
    setMapas(null)
    listLpuMaterialMapPorMaterial(id).catch((err) => { setError(err instanceof Error ? err.message : String(err)); return [] }).then(setMapas)
  }

  const tendidoDirty = !!material && tipoTendido.trim() !== (material.tipoTendido ?? '')

  async function guardarTendido() {
    if (!material) return
    setSavingTendido(true)
    setTendidoMsg(null)
    try {
      const valor = tipoTendido.trim() || null
      await updateMaterialTendido(material.id, { tipoTendido: valor, capacidad: material.capacidad })
      onTendidoSaved(material.id, valor)
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
      onMapeosChange()
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
      onMapeosChange()
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
      onMapeosChange()
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
          <label className="block text-xs text-slate-300 space-y-1">
            <span>Tipo de tendido (solo cables — va en la columna "Tipo de tendido" del EP)</span>
            <input value={tipoTendido} onChange={(e) => setTipoTendido(e.target.value)} placeholder="Subterráneo / Aéreo…"
              className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
          </label>
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
