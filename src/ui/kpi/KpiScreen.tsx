// Panel de KPIs: proyectos (OTT/Preventivos/Incidencias) + consumo de
// materiales, filtrable por periodo y área. Solo admin/jp/log — mismo
// público que puede mover inventario (is_jp_or_admin en la BD, ver
// supabase/migrations/0023_kpi_rpcs.sql).

import { useEffect, useMemo, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { useAuth } from '@/lib/auth'
import { listUbicaciones } from '@/lib/inventario/inventarioRepo'
import type { Ubicacion } from '@/lib/inventario/types'
import { KpiMaterialesTable } from './KpiMaterialesTable'
import { KpiProyectosPanel } from './KpiProyectosPanel'

type AreaSel = 'ATT' | 'OyM' | 'inventario'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

interface MesOpcion { key: string; label: string; desde: string; hasta: string }

function ultimosMeses(n: number): MesOpcion[] {
  const now = new Date()
  const out: MesOpcion[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const desde = new Date(d.getFullYear(), d.getMonth(), 1)
    const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
    const label = desde.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
    out.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), desde: toISODate(desde), hasta: toISODate(hasta) })
  }
  return out
}

const inputCls = 'bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'

export function KpiScreen() {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeVer = rol === 'admin' || rol === 'jp' || rol === 'log'

  const meses = useMemo(() => ultimosMeses(12), [])
  const [mesSel, setMesSel] = useState(meses[0]?.key ?? '')
  const [desde, setDesde] = useState(meses[0]?.desde ?? toISODate(new Date()))
  const [hasta, setHasta] = useState(meses[0]?.hasta ?? toISODate(new Date()))
  const [area, setArea] = useState<AreaSel>('ATT')

  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [bodegaId, setBodegaId] = useState('')
  const [tecnicoIds, setTecnicoIds] = useState<string[]>([])
  const [tecnicoSel, setTecnicoSel] = useState('')

  useEffect(() => {
    listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {})
    adminRepo.listProfiles()
      .then((all) => setTecnicos(all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log'))))
      .catch(() => {})
  }, [])

  function elegirMes(key: string) {
    setMesSel(key)
    const m = meses.find((x) => x.key === key)
    if (m) { setDesde(m.desde); setHasta(m.hasta) }
  }

  function agregarTecnico(id: string) {
    if (!id || tecnicoIds.includes(id)) return
    setTecnicoIds((prev) => [...prev, id])
    setTecnicoSel('')
  }
  function quitarTecnico(id: string) {
    setTecnicoIds((prev) => prev.filter((x) => x !== id))
  }

  if (!puedeVer) {
    return (
      <div className="text-center py-16 text-slate-500 space-y-2">
        <div className="text-4xl">🔒</div>
        <p className="text-sm">No tienes permiso para ver este panel.</p>
      </div>
    )
  }

  const bodegaC088 = bodegas.find((b) => b.nombre === 'C088')?.id ?? null
  const bodegaC132 = bodegas.find((b) => b.nombre === 'C132')?.id ?? null
  const tecnicosDisponibles = tecnicos.filter((t) => !tecnicoIds.includes(t.id))
  const tecnicosElegidos = tecnicos.filter((t) => tecnicoIds.includes(t.id))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">📊 KPI</h1>
        <p className="text-xs text-slate-400">Actividad de proyectos y consumo de materiales por periodo.</p>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 col-span-2">
            <span className="text-[11px] text-slate-400">Mes</span>
            <select value={mesSel} onChange={(e) => elegirMes(e.target.value)} className={`${inputCls} w-full`}>
              {meses.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">Desde</span>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} w-full`} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">Hasta</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} w-full`} />
          </label>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => setArea('ATT')}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${area === 'ATT' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            ATT
          </button>
          <button type="button" onClick={() => setArea('OyM')}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${area === 'OyM' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            OyM
          </button>
          <button type="button" onClick={() => setArea('inventario')}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${area === 'inventario' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            Inventario
          </button>
        </div>
      </div>

      {area === 'ATT' && (
        <>
          <KpiProyectosPanel titulo="OTT" area="ATT" desde={desde} hasta={hasta} />
          <KpiMaterialesTable titulo="Material por proyecto" area="ATT" desde={desde} hasta={hasta} />
          <KpiMaterialesTable titulo="Inventario (C088)" area="ATT" desde={desde} hasta={hasta} ubicacionId={bodegaC088} />
        </>
      )}

      {area === 'OyM' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <KpiProyectosPanel titulo="Preventivos" area="OyM" subarea="preventivo" desde={desde} hasta={hasta} />
            <KpiProyectosPanel titulo="Incidencias" area="OyM" subarea="incidencia" desde={desde} hasta={hasta} />
          </div>
          <KpiMaterialesTable titulo="Material por proyecto (Preventivos + Incidencias)" area="OyM" desde={desde} hasta={hasta} />
          <KpiMaterialesTable titulo="Inventario (C132 + Consumibles)" area="OyM" desde={desde} hasta={hasta} ubicacionId={bodegaC132} />
        </>
      )}

      {area === 'inventario' && (
        <>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
            <label className="space-y-1 block">
              <span className="text-[11px] text-slate-400">Bodega</span>
              <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">Todas</option>
                {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </label>
            <div className="space-y-1.5">
              <span className="text-[11px] text-slate-400">Técnicos</span>
              {tecnicosElegidos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tecnicosElegidos.map((t) => (
                    <span key={t.id} className="flex items-center gap-1 bg-slate-700/50 rounded-lg px-2 py-1 text-xs text-slate-200">
                      {t.nombre?.trim() || t.email}
                      <button type="button" onClick={() => quitarTecnico(t.id)} className="text-slate-500 hover:text-red-400">×</button>
                    </span>
                  ))}
                </div>
              )}
              {tecnicosDisponibles.length > 0 && (
                <div className="flex gap-2">
                  <select value={tecnicoSel} onChange={(e) => setTecnicoSel(e.target.value)} className={`${inputCls} flex-1 min-w-0`}>
                    <option value="">Elegir técnico o logística…</option>
                    {tecnicosDisponibles.map((t) => <option key={t.id} value={t.id}>{t.nombre?.trim() || t.email}</option>)}
                  </select>
                  <button type="button" onClick={() => agregarTecnico(tecnicoSel)} disabled={!tecnicoSel}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
                    + Agregar
                  </button>
                </div>
              )}
              {tecnicosElegidos.length === 0 && (
                <p className="text-[10px] text-slate-500">Sin técnicos elegidos: se muestran todos.</p>
              )}
            </div>
          </div>
          <KpiMaterialesTable titulo="Inventario" area={null} desde={desde} hasta={hasta}
            ubicacionId={bodegaId || null} tecnicoIds={tecnicoIds} />
        </>
      )}
    </div>
  )
}
