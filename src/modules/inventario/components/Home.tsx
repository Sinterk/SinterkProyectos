import { useEffect, useState, type ReactNode } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { ProjectSummary } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { RegistrarMovimientoForm } from '@/ui/RegistrarMovimientoForm'
import { ResumenProyectoTable, Stat } from '@/ui/ResumenProyectoTable'
import { getStock, getTecnicoLedger, listMovimientos, listUbicaciones } from '@/lib/inventario/inventarioRepo'
import type { ListMovimientosFilters } from '@/lib/inventario/inventarioRepo'
import type { Movimiento, StockRow, TecnicoLedgerRow, Ubicacion } from '@/lib/inventario/types'

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
          {rows.map((r) => (
            <div key={`${r.ubicacionId}|${r.materialId}|${r.lote}`} className="bg-slate-800 rounded-xl border border-slate-700 p-3 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{r.materialSku} — {r.materialDescripcion}</p>
                <p className="text-slate-500">{r.ubicacionNombre} · lote {r.lote}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-white font-semibold">{r.cantidadFisico}</p>
                <p className="text-[10px] text-slate-500">físico</p>
                {r.cantidadDigital !== 0 && <p className="text-[10px] text-amber-400 mt-0.5">{r.cantidadDigital} digital</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
  return (
    <div className="text-center py-16 text-slate-500 space-y-2">
      <div className="text-4xl">📋</div>
      <p className="text-sm">Conteo de inventario — próximamente.</p>
    </div>
  )
}
