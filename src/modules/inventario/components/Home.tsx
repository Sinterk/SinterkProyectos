import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { RegistrarMovimientoForm } from '@/ui/RegistrarMovimientoForm'
import { ResumenProyectoTable } from '@/ui/ResumenProyectoTable'
import { UbicacionSelect } from '@/ui/UbicacionSelect'
import { useFileDrop } from '@/ui/useFileDrop'
import {
  getStock, getTecnicoLedger, listMovimientos, listMateriales, listUbicaciones,
  updateMaterialStockMinimo, updateMaterialComentario,
  listConteos, getConteoLineas, abrirConteo, agregarLineaConteo, actualizarLineaConteo, cerrarConteo, descartarConteo,
  listEventosInventario, resolverEventoInventario, importarFilasSapAConteo,
} from '@/lib/inventario/inventarioRepo'
import type { ListMovimientosFilters, ImportarSapResultado } from '@/lib/inventario/inventarioRepo'
import type {
  Movimiento, StockRow, TecnicoLedgerRow, Ubicacion, Material,
  Conteo, ConteoLinea, EventoInventario, ResolucionEvento,
} from '@/lib/inventario/types'
import { parseArchivoXlsx, parseTextoPegado } from '@/lib/inventario/importarSap'
import type { FilaImportSap } from '@/lib/inventario/importarSap'
import { compareSku } from '@/lib/inventario/sku'
import { ColumnHeader } from '@/ui/ColumnHeader'

type MainTab = 'movimientos' | 'bodega' | 'proyecto' | 'tecnico' | 'conteo'

const TIPO_LABELS_MOV: Record<string, string> = {
  entrada: 'Entrada', salida: 'Salida', traslado: 'Traslado/Devuelto',
  rebaja: 'Rebajado (SAP)', solicitud: 'Solicitud', instalado: 'Instalado', merma: 'Merma',
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
      </div>

      {tab === 'movimientos' && <EntradasSalidasTab />}
      {tab === 'bodega' && <BodegaTab />}
      {tab === 'proyecto' && <ProyectoTab />}
      {tab === 'tecnico' && <TecnicoTab />}
      {tab === 'conteo' && <ConteoTab />}
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
      {sub === 'registro'
        ? <RegistrarMovimientoForm onRegistered={() => setRefreshKey((k) => k + 1)} />
        : <MovimientosTab refreshKey={refreshKey} />}
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
    case 'bodega': return m.ubicacionNombre
    case 'proyecto': return m.projectOtt ?? ''
    case 'area': return m.area ?? ''
    case 'tecnico': return m.usuarioNombre ?? ''
    case 'nota': return m.nota ?? ''
  }
}

/** Igual que stockColDisplayValue: texto para el checklist de filtro (por eso los campos vacíos se ven como "Sin X", no como cadena vacía). */
function movColDisplayValue(m: Movimiento, key: MovColKey): string {
  if (key === 'proyecto') return m.projectOtt || SIN_PROYECTO
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
  const [rows, setRows] = useState<Movimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [search, setSearch] = useState('')

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
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr><td colSpan={MOV_COLUMNS.length} className="px-2 py-3 text-center text-slate-500">
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
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.ubicacionNombre}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.projectOtt ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.area ?? '—'}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.usuarioNombre ?? '—'}</td>
                  <td className="px-2 py-2 max-w-[220px]"><p className="text-slate-400 truncate">{m.nota ?? '—'}</p></td>
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
      setEventos(evs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey])

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {eventos && eventos.length > 0 && <EventosAbiertosSection eventos={eventos} onResolved={reload} />}

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

const RESOLUCION_LABELS: Record<ResolucionEvento, string> = {
  devolucion_pendiente: 'Devolución pendiente',
  reubicacion: 'Reubicación',
  perdida: 'Pérdida',
}

function EventosAbiertosSection({ eventos, onResolved }: { eventos: EventoInventario[]; onResolved: () => void }) {
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolucion, setResolucion] = useState<ResolucionEvento>('reubicacion')
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmar(eventoId: string) {
    setBusy(true)
    setError(null)
    try {
      await resolverEventoInventario(eventoId, resolucion, nota.trim() || undefined)
      setResolvingId(null)
      setNota('')
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-amber-950/40 border border-amber-700/50 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold text-amber-300">⚠️ {eventos.length} diferencia(s) por resolver</p>
      <div className="space-y-2">
        {eventos.map((e) => (
          <div key={e.id} className="bg-slate-800/60 rounded-xl p-3 text-xs space-y-2">
            <p className="text-white">{e.materialSku} — {e.materialDescripcion}</p>
            <p className="text-slate-400">
              {e.ubicacionNombre} · lote {e.lote} · diferencia{' '}
              <span className={e.diferencia < 0 ? 'text-red-400' : 'text-amber-400'}>{e.diferencia > 0 ? '+' : ''}{e.diferencia}</span>
            </p>
            {resolvingId === e.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <select value={resolucion} onChange={(ev) => setResolucion(ev.target.value as ResolucionEvento)}
                  className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                  {(Object.keys(RESOLUCION_LABELS) as ResolucionEvento[]).map((r) => <option key={r} value={r}>{RESOLUCION_LABELS[r]}</option>)}
                </select>
                <input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Nota (opcional)"
                  className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none flex-1 min-w-[120px]" />
                <button type="button" disabled={busy} onClick={() => confirmar(e.id)}
                  className="text-xs font-semibold px-2 py-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
                  Confirmar
                </button>
                <button type="button" onClick={() => setResolvingId(null)} className="text-xs text-slate-400">Cancelar</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setResolvingId(e.id); setResolucion('reubicacion'); setNota('') }}
                className="text-xs text-amber-400 font-semibold">
                Resolver →
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function ConteoDetail({ conteoId, onBack }: { conteoId: string; onBack: () => void }) {
  const [conteo, setConteo] = useState<Conteo | null>(null)
  const [lineas, setLineas] = useState<ConteoLinea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  async function reload() {
    try {
      const [cs, ls] = await Promise.all([listConteos(), getConteoLineas(conteoId)])
      setConteo(cs.find((c) => c.id === conteoId) ?? null)
      setLineas(ls)
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

          <div className="space-y-1.5">
            {lineas.length === 0 && <p className="text-xs text-slate-500">Sin líneas — el sistema no tenía stock en esta ubicación.</p>}
            {lineas.map((l) => (
              <ConteoLineaRow key={l.id} linea={l} editable={abierto} onSaved={reload}
                onPendienteChange={(pendiente) => marcarPendiente(l.id, pendiente)} />
            ))}
          </div>

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

function ConteoLineaRow({ linea, editable, onSaved, onPendienteChange }: {
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
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-xs flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm text-white truncate">{linea.materialSku} — {linea.materialDescripcion}</p>
        <p className="text-slate-500">lote {linea.lote} · {linea.primeraVez ? 'primer conteo aquí' : `sistema: ${linea.cantidadSistema}`}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {editable ? (
          <>
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
              className="text-sm w-7 h-7 rounded-lg bg-slate-700 border border-slate-600 disabled:opacity-30 text-green-400 hover:bg-slate-600 disabled:hover:bg-slate-700">
              {saving ? '⏳' : '✓'}
            </button>
          </>
        ) : (
          <span className="text-white font-semibold">{linea.cantidadContada}</span>
        )}
        {!linea.primeraVez && diferencia !== 0 && (
          <span className={`text-[10px] font-semibold ${diferencia < 0 ? 'text-red-400' : 'text-amber-400'}`}>
            {diferencia > 0 ? '+' : ''}{diferencia}
          </span>
        )}
      </div>
    </div>
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
