// Admin: mapeos que alimentan el "regenerar avance" del Estado de Pago (EP)
// — ver docs/CONTINUAR-BACKEND.md punto 19. Dos partes independientes:
// (a) por material (código LPU + factor de cantidad, y tipo de tendido/
//     capacidad para SKUs de cable) y (b) tendido→código por capacidad.
// Primera versión — a propósito simple (buscador de texto, sin ColumnHeader
// con orden/checklist como Bodega/KPI) porque el admin solo necesita
// encontrar UN material o UNA fila a la vez, no analizar la tabla completa.

import { useEffect, useMemo, useState } from 'react'
import { MaterialSelect } from '@/ui/MaterialSelect'
import { LpuCodigoSelect } from '@/ui/LpuCodigoSelect'
import { listMateriales, updateMaterialTendido } from '@/lib/inventario/inventarioRepo'
import type { Material } from '@/lib/inventario/types'
import {
  listLpuCodigos, listLpuMaterialMapPorMaterial, crearLpuMaterialMap, actualizarLpuMaterialMap, borrarLpuMaterialMap,
  listLpuTendidoMap, crearLpuTendidoMap, actualizarLpuTendidoMap, borrarLpuTendidoMap,
} from '@/lib/lpu/lpuRepo'
import type { LpuCodigo, LpuMaterialMap, LpuTendidoMap } from '@/lib/lpu/types'

export function LpuMapeoSection() {
  const [materiales, setMateriales] = useState<Material[] | null>(null)
  const [codigos, setCodigos] = useState<LpuCodigo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listMateriales().then(setMateriales).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    listLpuCodigos().then(setCodigos).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material → Código LPU</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Qué línea del Estado de Pago sugiere cada material instalado (ej. mufa → confección + fusión), y el tipo de tendido/capacidad de los SKUs de cable.
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {!materiales || !codigos ? (
          <p className="text-xs text-slate-500">Cargando…</p>
        ) : (
          <MaterialMapEditor materiales={materiales} codigos={codigos} />
        )}
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
        <div>
          <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Tendido → Código LPU</h2>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Qué código LPU corresponde a cada combinación de tipo de tendido + rango de capacidad (n° de hilos).
          </p>
        </div>
        {!codigos ? <p className="text-xs text-slate-500">Cargando…</p> : <TendidoMapEditor codigos={codigos} />}
      </div>
    </div>
  )
}

function MaterialMapEditor({ materiales, codigos }: { materiales: Material[]; codigos: LpuCodigo[] }) {
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

function TendidoMapEditor({ codigos }: { codigos: LpuCodigo[] }) {
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
