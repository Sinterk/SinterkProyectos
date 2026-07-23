// Formulario compartido de "Registrar movimiento", usado en 3 lugares:
// pestaña Logística de ATT, pestaña Logística de Preventivos (con selector
// de punto), y la ventana Inventario → Entradas/Salidas → Registro. La
// lógica de negocio vive en la función de BD `registrar_movimiento` (ver
// supabase/migrations/0005_registrar_movimiento.sql y 0007 para el caso de
// "Salida preventiva" sin proyecto); este componente solo arma el input y
// muestra resultado por línea.

import { useEffect, useRef, useState } from 'react'
import { nanoid } from '@/core/utils/nanoid'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile, ProjectSummary } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { BODEGA_DEFECTO_POR_AREA } from '@/lib/inventario/defaults'
import { listMateriales, listUbicaciones, registrarMovimiento } from '@/lib/inventario/inventarioRepo'
import type { Material, MovimientoTipoUI, Ubicacion } from '@/lib/inventario/types'
import { LoteSelect } from './LoteSelect'
import { MaterialSelect } from './MaterialSelect'
import { UbicacionSelect } from './UbicacionSelect'

const PREVENTIVA = '__preventiva__'
const NINGUN_PUNTO = ''

const SALIDA_TIPOS: MovimientoTipoUI[] = ['solicitud', 'entrega', 'instalado', 'devuelto', 'rebajado']
const TIPO_LABELS: Record<MovimientoTipoUI, string> = {
  entrada: 'Entrada', solicitud: 'Solicitud', entrega: 'Entrega',
  instalado: 'Instalado', devuelto: 'Devuelto', rebajado: 'Rebajado (SAP)',
}
/** Tipos de Salida que no exigen proyecto (permiten "Salida preventiva"). */
const PROYECTO_OPCIONAL: MovimientoTipoUI[] = ['entrega', 'devuelto']
/** Tipos de Salida cuya bodega de origen/destino se elige por línea de material. */
const NECESITA_BODEGA_POR_LINEA: MovimientoTipoUI[] = ['entrega', 'devuelto', 'rebajado']

interface MaterialLinea {
  localId: string
  materialId: string
  cantidad: string
  lote: string
  ubicacionBodegaId: string
}

function emptyLinea(ubicacionBodegaId = ''): MaterialLinea {
  return { localId: nanoid(8), materialId: '', cantidad: '', lote: '', ubicacionBodegaId }
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Props {
  /** Si se pasa, el formulario queda fijado a este proyecto (pestaña Logística de ATT/Preventivo). */
  fixedProject?: { id: string; ott: string; area: 'ATT' | 'OyM' }
  /** Solo desde la pestaña Logística de un Preventivo: habilita selector de punto del cuadrante. */
  puntos?: { id: string; nombre: string }[]
  /** Si se pasa, oculta el selector Entrada/Salida y de tipo, dejándolo fijo (alta rápida de material por punto, siempre 'instalado'). */
  lockTipoUI?: MovimientoTipoUI
  /** Se llama tras cada registro exitoso, para refrescar listas/resúmenes en el padre. */
  onRegistered?: () => void
}

export function RegistrarMovimientoForm({ fixedProject, puntos, lockTipoUI, onRegistered }: Props) {
  const [datosTipo, setDatosTipo] = useState<'entrada' | 'salida'>('salida')
  const [tipoUI, setTipoUI] = useState<MovimientoTipoUI>(lockTipoUI ?? 'entrega')

  const [materiales, setMateriales] = useState<Material[]>([])
  const [proyectos, setProyectos] = useState<ProjectSummary[]>([])
  const [tecnicos, setTecnicos] = useState<Profile[]>([])
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  const [ubicacionesTecnico, setUbicacionesTecnico] = useState<Ubicacion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // Datos — Entrada
  const [ubicacionEntradaId, setUbicacionEntradaId] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [documento, setDocumento] = useState('')

  // Datos — Salida
  const [projectSel, setProjectSel] = useState(fixedProject ? fixedProject.id : '')
  const [tecnicoUserId, setTecnicoUserId] = useState('')
  const [puntoId, setPuntoId] = useState(NINGUN_PUNTO)
  // Solo se usa sin proyecto (salida preventiva / consumibles): con proyecto,
  // el área se deriva sola del proyecto — no se le pide al usuario que la repita.
  const [areaSel, setAreaSel] = useState<'ATT' | 'OyM'>('OyM')

  const [fecha, setFecha] = useState(todayISODate())
  const [nota, setNota] = useState('')

  const [lineas, setLineas] = useState<MaterialLinea[]>([emptyLinea()])
  const [submitting, setSubmitting] = useState(false)
  const [resultados, setResultados] = useState<Record<string, { ok: boolean; texto: string }>>({})

  useEffect(() => {
    listMateriales().then(setMateriales).catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
    listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {})
    listUbicaciones({ tipo: 'tecnico' }).then(setUbicacionesTecnico).catch(() => {})
    if (fixedProject) {
      adminRepo.listMembers(fixedProject.id)
        .then((ms) => { setMembers(ms); setTecnicoUserId((prev) => prev || ms[0]?.id || '') })
        .catch(() => {})
    } else {
      adminRepo.listProfiles()
        .then((all) => setTecnicos(all.filter((p) => p.activo && (p.rol === 'tecnico' || p.rol === 'log'))))
        .catch(() => {})
      adminRepo.listActiveProjects().then(setProyectos).catch(() => {})
    }
  }, [fixedProject])

  // Bodega de origen/destino por defecto según el área del proyecto — se
  // aplica una sola vez, apenas se resuelve el id real de la bodega, y solo
  // a líneas que el usuario no haya tocado todavía.
  const defaultBodegaNombre = fixedProject ? BODEGA_DEFECTO_POR_AREA[fixedProject.area] : null
  const defaultBodegaId = defaultBodegaNombre ? bodegas.find((b) => b.nombre === defaultBodegaNombre)?.id ?? '' : ''
  const appliedDefaultBodega = useRef(false)
  useEffect(() => {
    if (!appliedDefaultBodega.current && defaultBodegaId) {
      appliedDefaultBodega.current = true
      setLineas((prev) => prev.map((l) => (l.ubicacionBodegaId ? l : { ...l, ubicacionBodegaId: defaultBodegaId })))
    }
  }, [defaultBodegaId])

  const esEntrada = !lockTipoUI && !fixedProject && datosTipo === 'entrada'
  const requiereProyecto = !PROYECTO_OPCIONAL.includes(tipoUI)
  const proyectoIdEfectivo = fixedProject ? fixedProject.id : (projectSel === PREVENTIVA ? null : projectSel || null)
  const necesitaBodegaPorLinea = !esEntrada && NECESITA_BODEGA_POR_LINEA.includes(tipoUI)
  // Sin proyecto (salida preventiva o consumibles): el área no se puede
  // derivar de ningún lado (puede salir material de cualquier bodega), así
  // que se elige a mano.
  const necesitaArea = !esEntrada && !requiereProyecto && proyectoIdEfectivo === null
  const tecnicoOptions = fixedProject
    ? members.map((m) => ({ id: m.id, label: m.nombre?.trim() || m.email || '' }))
    : tecnicos.map((t) => ({ id: t.id, label: t.nombre?.trim() || t.email }))
  const tecnicoUbicacionId = tecnicoUserId
    ? ubicacionesTecnico.find((u) => u.ownerUserId === tecnicoUserId)?.id ?? null
    : null

  /** A qué ubicación mirar para "cantidad disponible" del selector de lote, según el tipo de movimiento. */
  function loteContexto(l: MaterialLinea): { ubicacionId: string | null; naturaleza: 'fisico' | 'digital'; checkAvailability: boolean } {
    if (esEntrada) return { ubicacionId: ubicacionEntradaId || null, naturaleza: 'fisico', checkAvailability: false }
    switch (tipoUI) {
      case 'entrega': return { ubicacionId: l.ubicacionBodegaId || null, naturaleza: 'fisico', checkAvailability: true }
      case 'rebajado': return { ubicacionId: l.ubicacionBodegaId || null, naturaleza: 'digital', checkAvailability: true }
      case 'devuelto': return { ubicacionId: tecnicoUbicacionId, naturaleza: 'fisico', checkAvailability: true }
      case 'instalado': return { ubicacionId: tecnicoUbicacionId, naturaleza: 'fisico', checkAvailability: true }
      default: return { ubicacionId: null, naturaleza: 'fisico', checkAvailability: false }
    }
  }

  function updateLinea(localId: string, patch: Partial<MaterialLinea>) {
    setLineas((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)))
  }
  function addLinea() {
    setLineas((prev) => [...prev, emptyLinea(defaultBodegaId)])
  }
  function removeLinea(localId: string) {
    setLineas((prev) => (prev.length > 1 ? prev.filter((l) => l.localId !== localId) : prev))
  }

  function validar(): string | null {
    if (esEntrada && !ubicacionEntradaId) return 'Falta la bodega de destino'
    if (!esEntrada) {
      if (requiereProyecto && !proyectoIdEfectivo) return 'Este tipo de movimiento requiere un proyecto'
      if (!tecnicoUserId) return 'Falta elegir el técnico'
    }
    for (const l of lineas) {
      if (!l.materialId) return 'Falta elegir material en alguna línea'
      const n = Number(l.cantidad)
      if (!l.cantidad || !(n > 0)) return 'Cantidad inválida en alguna línea'
      if (necesitaBodegaPorLinea && !l.ubicacionBodegaId) return 'Falta la bodega en alguna línea'
    }
    return null
  }

  async function submit() {
    const err = validar()
    if (err) {
      setResultados({ __general__: { ok: false, texto: err } })
      return
    }
    setSubmitting(true)
    setResultados({})
    const fechaISO = fecha ? new Date(fecha).toISOString() : undefined
    const notaEfectiva = !esEntrada && proyectoIdEfectivo === null && !nota.trim() ? 'Salida preventiva' : (nota.trim() || undefined)

    const nuevos: Record<string, { ok: boolean; texto: string }> = {}
    const restantes: MaterialLinea[] = []
    for (const l of lineas) {
      try {
        await registrarMovimiento({
          tipoUI: esEntrada ? 'entrada' : tipoUI,
          materialId: l.materialId,
          cantidad: Number(l.cantidad),
          lote: l.lote.trim() || undefined,
          fecha: fechaISO,
          nota: notaEfectiva,
          ubicacionBodegaId: esEntrada ? ubicacionEntradaId : (necesitaBodegaPorLinea ? l.ubicacionBodegaId : undefined),
          proveedor: esEntrada ? (proveedor.trim() || undefined) : undefined,
          documento: esEntrada ? (documento.trim() || undefined) : undefined,
          projectId: esEntrada ? undefined : (proyectoIdEfectivo ?? undefined),
          puntoId: esEntrada ? undefined : (puntos ? (puntoId || null) : undefined),
          tecnicoUserId: esEntrada ? undefined : tecnicoUserId,
          area: necesitaArea ? areaSel : undefined,
        })
        nuevos[l.localId] = { ok: true, texto: 'Registrado' }
      } catch (e) {
        nuevos[l.localId] = { ok: false, texto: e instanceof Error ? e.message : String(e) }
        restantes.push(l)
      }
    }
    setResultados(nuevos)
    setSubmitting(false)
    if (restantes.length === 0) {
      setLineas([emptyLinea(defaultBodegaId)])
      onRegistered?.()
    } else {
      setLineas(restantes)
    }
  }

  const inputCls = 'bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const labelCls = 'text-[11px] text-slate-400'

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-4">
      {loadError && <p className="text-xs text-red-400">{loadError}</p>}

      {!lockTipoUI && !fixedProject && (
        <div className="flex gap-2">
          <button type="button" onClick={() => setDatosTipo('salida')}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${datosTipo === 'salida' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            Salida
          </button>
          <button type="button" onClick={() => setDatosTipo('entrada')}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${datosTipo === 'entrada' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
            Entrada
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {esEntrada ? (
          <>
            <label className="space-y-1 col-span-2">
              <span className={labelCls}>Bodega destino</span>
              <UbicacionSelect value={ubicacionEntradaId} onChange={setUbicacionEntradaId} tipo="bodega"
                placeholder="Elegir bodega…" className={`${inputCls} w-full`} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Proveedor</span>
              <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={`${inputCls} w-full`} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>N° documento</span>
              <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={`${inputCls} w-full`} />
            </label>
          </>
        ) : (
          <>
            {!lockTipoUI && (
              <label className="space-y-1 col-span-2">
                <span className={labelCls}>Tipo</span>
                <select value={tipoUI} onChange={(e) => setTipoUI(e.target.value as MovimientoTipoUI)} className={`${inputCls} w-full`}>
                  {SALIDA_TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABELS[t]}</option>)}
                </select>
              </label>
            )}
            {!fixedProject && (
              <label className="space-y-1 col-span-2">
                <span className={labelCls}>Proyecto</span>
                <select value={projectSel} onChange={(e) => setProjectSel(e.target.value)} className={`${inputCls} w-full`}>
                  <option value="">Elegir proyecto…</option>
                  {!requiereProyecto && <option value={PREVENTIVA}>🅿️ Salida preventiva (sin proyecto)</option>}
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.area === 'ATT' ? 'ATT' : 'Preventivo'}] {p.ott || 'Sin código'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {necesitaArea && (
              <label className="space-y-1 col-span-2">
                <span className={labelCls}>Área (consumibles / salida preventiva)</span>
                <select value={areaSel} onChange={(e) => setAreaSel(e.target.value as 'ATT' | 'OyM')} className={`${inputCls} w-full`}>
                  <option value="ATT">ATT</option>
                  <option value="OyM">OyM (Preventivos/Incidencias)</option>
                </select>
              </label>
            )}
            <label className="space-y-1 col-span-2">
              <span className={labelCls}>Técnico</span>
              <select value={tecnicoUserId} onChange={(e) => setTecnicoUserId(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">Elegir técnico…</option>
                {tecnicoOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {puntos && puntos.length > 0 && (
              <label className="space-y-1 col-span-2">
                <span className={labelCls}>Punto</span>
                <select value={puntoId} onChange={(e) => setPuntoId(e.target.value)} className={`${inputCls} w-full`}>
                  <option value={NINGUN_PUNTO}>Ningún punto en particular</option>
                  {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        <label className="space-y-1">
          <span className={labelCls}>Fecha</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={`${inputCls} w-full`} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Nota</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className={`${inputCls} w-full`} />
        </label>
      </div>

      <div className="space-y-2">
        <span className={labelCls}>Material</span>
        {lineas.map((l) => {
          const r = resultados[l.localId]
          const ctx = loteContexto(l)
          return (
            <div key={l.localId} className="bg-slate-700/50 rounded-xl p-2 space-y-2">
              <div className="grid grid-cols-6 gap-1.5">
                <MaterialSelect materiales={materiales} value={l.materialId}
                  onChange={(id) => updateLinea(l.localId, { materialId: id, lote: '' })}
                  className="col-span-3" />
                <input type="number" min="0" step="any" placeholder="Cant." value={l.cantidad}
                  onChange={(e) => updateLinea(l.localId, { cantidad: e.target.value })} className={`${inputCls} col-span-1`} />
                <LoteSelect materialId={l.materialId} ubicacionId={ctx.ubicacionId} naturaleza={ctx.naturaleza}
                  checkAvailability={ctx.checkAvailability} value={l.lote}
                  onChange={(lote) => updateLinea(l.localId, { lote })} className={`${inputCls} col-span-1`} />
                <button type="button" onClick={() => removeLinea(l.localId)} disabled={lineas.length === 1}
                  className="col-span-1 text-xs text-red-400 disabled:opacity-30">Quitar</button>
              </div>
              {necesitaBodegaPorLinea && (
                <UbicacionSelect value={l.ubicacionBodegaId} onChange={(id) => updateLinea(l.localId, { ubicacionBodegaId: id, lote: '' })}
                  tipo="bodega" placeholder={`Bodega de ${tipoUI === 'devuelto' ? 'destino' : 'origen'}…`}
                  className={`${inputCls} w-full`} />
              )}
              {r && <p className={`text-xs ${r.ok ? 'text-green-400' : 'text-red-400'}`}>{r.texto}</p>}
            </div>
          )
        })}
        <button type="button" onClick={addLinea} className="text-xs text-brand-400 font-semibold">+ Agregar línea</button>
      </div>

      {resultados.__general__ && <p className="text-xs text-red-400">{resultados.__general__.texto}</p>}
      <button type="button" onClick={submit} disabled={submitting}
        className="w-full text-sm font-semibold py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
        {submitting ? 'Registrando…' : 'Registrar movimiento'}
      </button>
    </div>
  )
}
