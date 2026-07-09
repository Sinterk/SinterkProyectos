import { useEffect, useState, type ReactNode } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { RegistrarMovimientoForm } from '@/ui/RegistrarMovimientoForm'
import { ResumenProyectoTable, Stat } from '@/ui/ResumenProyectoTable'
import { UbicacionSelect } from '@/ui/UbicacionSelect'
import { useFileDrop } from '@/ui/useFileDrop'
import {
  getStock, getTecnicoLedger, listMovimientos, listMateriales, listUbicaciones, updateMaterialStockMinimo,
  listConteos, getConteoLineas, abrirConteo, agregarLineaConteo, actualizarLineaConteo, cerrarConteo,
  listEventosInventario, resolverEventoInventario, importarFilasSapAConteo,
} from '@/lib/inventario/inventarioRepo'
import type { ListMovimientosFilters, ImportarSapResultado } from '@/lib/inventario/inventarioRepo'
import type {
  Movimiento, StockRow, TecnicoLedgerRow, Ubicacion, Material,
  Conteo, ConteoLinea, EventoInventario, ResolucionEvento,
} from '@/lib/inventario/types'
import { parseArchivoXlsx, parseTextoPegado } from '@/lib/inventario/importarSap'
import type { FilaImportSap } from '@/lib/inventario/importarSap'

type MainTab = 'movimientos' | 'bodega' | 'proyecto' | 'tecnico' | 'conteo'

const TIPO_LABELS_MOV: Record<string, string> = {
  entrada: 'Entrada', salida: 'Salida', traslado: 'Traslado/Devuelto',
  rebaja: 'Rebajado (SAP)', solicitud: 'Solicitud', instalado: 'Instalado',
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

function MovimientosTab({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Movimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tipo, setTipo] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [search, setSearch] = useState('')

  async function reload() {
    try {
      const filters: ListMovimientosFilters = {}
      if (tipo) filters.tipo = tipo
      if (desde) filters.desde = new Date(desde).toISOString()
      if (hasta) filters.hasta = new Date(`${hasta}T23:59:59`).toISOString()
      setRows(await listMovimientos(filters))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tipo, desde, hasta, refreshKey])

  const q = search.trim().toLowerCase()
  const filtered = (rows ?? []).filter((m) => !q
    || m.materialSku.toLowerCase().includes(q)
    || m.materialDescripcion.toLowerCase().includes(q)
    || m.ubicacionNombre.toLowerCase().includes(q)
    || (m.usuarioNombre ?? '').toLowerCase().includes(q)
    || (m.projectOtt ?? '').toLowerCase().includes(q))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…"
          className={`${inputCls} col-span-2`} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABELS_MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex gap-1">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} w-full`} />
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} w-full`} />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {rows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-slate-500">Sin movimientos.</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((m) => (
            <div key={m.id} className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{TIPO_LABELS_MOV[m.tipo] ?? m.tipo}</span>
                <span className="text-slate-500">{new Date(m.fecha).toLocaleDateString('es-CL', { timeZone: 'UTC' })}</span>
              </div>
              <p className="text-slate-300 mt-1">{m.materialSku} — {m.materialDescripcion} · {m.cantidad} · lote {m.lote}</p>
              <p className="text-slate-500 mt-0.5">
                {m.ubicacionNombre}
                {m.projectOtt ? ` · OTT ${m.projectOtt}` : ''}
                {m.usuarioNombre ? ` · ${m.usuarioNombre}` : ''}
              </p>
              {m.nota && <p className="text-slate-500 italic mt-0.5">{m.nota}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BodegaTab() {
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  const [ubicacionId, setUbicacionId] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {}) }, [])

  async function reload() {
    try { setRows(await getStock({ ubicacionId: ubicacionId || undefined, search: search || undefined })) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ubicacionId, search])

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
      {rows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">Sin stock registrado.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const negativo = r.cantidadFisico < 0
            const bajoUmbral = !negativo && r.stockMinimo !== null && r.cantidadFisico <= r.stockMinimo
            return (
              <div key={`${r.ubicacionId}|${r.materialId}|${r.lote}`}
                className={`bg-slate-800 rounded-xl border p-3 text-xs flex items-center justify-between gap-2 ${negativo ? 'border-red-700/60' : bajoUmbral ? 'border-amber-700/60' : 'border-slate-700'}`}>
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{r.materialSku} — {r.materialDescripcion}</p>
                  <p className="text-slate-500">{r.ubicacionNombre} · lote {r.lote}</p>
                  <UmbralEditor materialId={r.materialId} value={r.stockMinimo} onSaved={reload} />
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-semibold ${negativo ? 'text-red-400' : bajoUmbral ? 'text-amber-400' : 'text-white'}`}>
                    {negativo && '⚠ '}{r.cantidadFisico}
                  </p>
                  <p className="text-[10px] text-slate-500">físico</p>
                  {r.cantidadDigital !== 0 && (
                    <p className={`text-[10px] mt-0.5 ${r.cantidadDigital < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {r.cantidadDigital < 0 && '⚠ '}{r.cantidadDigital} digital
                    </p>
                  )}
                  {negativo && <p className="text-[10px] text-red-400 mt-0.5">Descuadre — revisar</p>}
                  {bajoUmbral && <p className="text-[10px] text-amber-400 mt-0.5">Renovar (mín. {r.stockMinimo})</p>}
                </div>
              </div>
            )
          })}
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
          {projectId && <ResumenProyectoTable projectId={projectId} />}
        </>
      )}
    </div>
  )
}

function TecnicoTab() {
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [userId, setUserId] = useState('')
  const [rows, setRows] = useState<TecnicoLedgerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    getTecnicoLedger(userId).then(setRows).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [userId])

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
          {rows === null ? (
            <p className="text-xs text-slate-500">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-500">Sin material entregado.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={`${r.projectId ?? ''}|${r.materialId}|${r.lote}`} className="bg-slate-800 rounded-xl border border-slate-700 p-3 space-y-2">
                  <div>
                    <p className="text-sm text-white">{r.materialSku} — {r.materialDescripcion}</p>
                    <p className="text-[11px] text-slate-500">
                      Lote {r.lote} · {r.projectOtt
                        ? `[${r.projectArea === 'ATT' ? 'ATT' : 'Preventivo'}] OTT ${r.projectOtt}`
                        : '🅿️ Preventivo (sin proyecto)'}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    <Stat label="Entreg." value={r.cantEntregada} />
                    <Stat label="Instal." value={r.cantInstalada} />
                    <Stat label="Devuelto" value={r.cantDevuelta} />
                    <Stat label="Tránsito" value={r.cantTransito} highlight={r.cantTransito > 0} />
                  </div>
                </div>
              ))}
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

          {abierto && conteo.naturaleza === 'digital' && (
            <ImportarSapSection conteoId={conteoId} onImported={reload} onImportingChange={setImportando} />
          )}

          {abierto && <AgregarLineaForm conteoId={conteoId} onAdded={reload} />}

          {abierto ? (
            <>
              {hayPendientes && (
                <p className="text-[11px] text-amber-400 text-center">Hay cantidades sin guardar — toca fuera del campo para guardarlas.</p>
              )}
              <button type="button" onClick={cerrar} disabled={closing || hayPendientes}
                className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
                {closing ? 'Cerrando…' : 'Cerrar conteo'}
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
          <input type="number" step="any" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} disabled={saving}
            className="w-20 bg-slate-700 text-white text-sm rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none text-right" />
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
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null)
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
    setProgreso({ hecho: 0, total: filas.length })
    setParseError(null)
    try {
      const res = await importarFilasSapAConteo(conteoId, filas, (hecho, total) => setProgreso({ hecho, total }))
      setResultado(res)
      limpiarPreview()
      onImported()
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgreso(null)
      onImportingChange(false)
    }
  }

  return (
    <div {...dropProps}
      className={`bg-slate-800/60 rounded-xl border border-dashed p-3 space-y-2 transition-colors ${isDragging ? 'border-brand-500 bg-brand-500/10' : 'border-slate-600'}`}>
      <p className="text-[11px] text-slate-500">
        Cargar conteo desde Excel SAP — columnas SAP/Material/Lote/Stock; el resto se ignora. Arrastra el .xlsx aquí o:
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
          {progreso && <p className="text-xs text-amber-400">Importando {progreso.hecho}/{progreso.total}…</p>}
          <div className="flex gap-2">
            <button type="button" onClick={confirmar} disabled={!!progreso}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
              {progreso ? 'Importando…' : `Confirmar importación (${filas.length})`}
            </button>
            <button type="button" onClick={limpiarPreview} disabled={!!progreso} className="text-xs text-slate-400">
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
