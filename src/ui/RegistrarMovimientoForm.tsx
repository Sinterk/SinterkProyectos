// Formulario compartido de "Registrar movimiento", usado en 3 lugares:
// pestaña Logística de ATT, pestaña Logística de Preventivos (con selector
// de punto), y la ventana Inventario → Registro → Entrada. La
// lógica de negocio vive en la función de BD `registrar_movimiento` (ver
// supabase/migrations/0005_registrar_movimiento.sql y 0007 para el caso de
// "Salida preventiva" sin proyecto); este componente solo arma el input y
// muestra resultado por línea.

import { Fragment, useEffect, useRef, useState } from 'react'
import { nanoid } from '@/core/utils/nanoid'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile, ProjectSummary } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import type { Profile } from '@/lib/auth'
import { BODEGA_DEFECTO_POR_AREA } from '@/lib/inventario/defaults'
import { esTipoFerreteria, LOTE_FISICO_FERRETERIA } from '@/lib/inventario/esFerreteria'
import { listMateriales, listUbicaciones, registrarMovimiento } from '@/lib/inventario/inventarioRepo'
import type { Material, MovimientoTipoUI, Ubicacion } from '@/lib/inventario/types'
import { LoteSelect } from './LoteSelect'
import { MaterialSelect } from './MaterialSelect'
import { ProyectoSelect } from './ProyectoSelect'
import { UbicacionSelect } from './UbicacionSelect'

const PREVENTIVA = '__preventiva__'
const NINGUN_PUNTO = ''

const SALIDA_TIPOS: MovimientoTipoUI[] = ['solicitud', 'entrega', 'instalado', 'devuelto', 'rebajado', 'merma', 'traslado_bodega']
const TIPO_LABELS: Record<MovimientoTipoUI, string> = {
  entrada: 'Entrada', solicitud: 'Solicitud', entrega: 'Entrega',
  instalado: 'Instalado', devuelto: 'Devuelto', rebajado: 'Rebajado (SAP)', merma: 'Merma',
  traslado_bodega: 'Traspaso entre bodegas',
  // No seleccionable desde este formulario compartido (solo desde
  // AsignacionesForm, en Inventario → Registro → Asignaciones) — está acá solo
  // para que el Record<MovimientoTipoUI, string> quede exhaustivo.
  conteo: 'Conteo',
}
/** Tipos de Salida que no exigen proyecto (permiten "Salida preventiva"). */
const PROYECTO_OPCIONAL: MovimientoTipoUI[] = ['entrega', 'devuelto']
/** Tipos de Salida cuya bodega de origen/destino se elige por línea de material. */
const NECESITA_BODEGA_POR_LINEA: MovimientoTipoUI[] = ['entrega', 'devuelto', 'rebajado', 'traslado_bodega']

interface MaterialLinea {
  localId: string
  materialId: string
  cantidad: string
  lote: string
  ubicacionBodegaId: string
  /** Solo 'traslado_bodega': bodega de destino del traspaso. */
  ubicacionBodegaDestinoId: string
}

function emptyLinea(ubicacionBodegaId = ''): MaterialLinea {
  return { localId: nanoid(8), materialId: '', cantidad: '', lote: '', ubicacionBodegaId, ubicacionBodegaDestinoId: '' }
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
  /** Si se pasa, oculta el selector Entrada/Salida y deja el formulario fijo
   *  en modo Entrada — usado desde Inventario → Registro, donde la subpestaña
   *  "Asignaciones" la maneja `AsignacionesForm` aparte. */
  soloEntrada?: boolean
  /** Se llama tras cada registro exitoso, para refrescar listas/resúmenes en el padre. */
  onRegistered?: () => void
}

export function RegistrarMovimientoForm({ fixedProject, puntos, lockTipoUI, soloEntrada, onRegistered }: Props) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeCrearProyecto = rol === 'admin' || rol === 'jp'
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
  // Solo se usa sin proyecto (salida preventiva / insumos): con proyecto,
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

  const esEntrada = soloEntrada || (!lockTipoUI && !fixedProject && datosTipo === 'entrada')
  // Traspaso entre bodegas: sin técnico ni proyecto — ambos extremos son bodegas.
  const esTraslado = tipoUI === 'traslado_bodega'
  const requiereProyecto = !PROYECTO_OPCIONAL.includes(tipoUI) && !esTraslado
  const proyectoIdEfectivo = fixedProject ? fixedProject.id : (projectSel === PREVENTIVA ? null : projectSel || null)
  const proyectoSeleccionado = proyectos.find((p) => p.id === proyectoIdEfectivo) ?? null
  const necesitaBodegaPorLinea = !esEntrada && NECESITA_BODEGA_POR_LINEA.includes(tipoUI)
  const necesitaBodegaDestinoPorLinea = esTraslado
  // Sin proyecto (salida preventiva o insumos): el área no se puede
  // derivar de ningún lado (puede salir material de cualquier bodega), así
  // que se elige a mano. No aplica a un traspaso entre bodegas (no reporta
  // consumo de ningún área).
  const necesitaArea = !esEntrada && !esTraslado && !requiereProyecto && proyectoIdEfectivo === null

  // Bodega de origen/destino por defecto según el área — antes solo se
  // aplicaba con `fixedProject` (pestaña Logística de ATT/Preventivo); acá
  // (Inventario → Registro, sin fixedProject) el área recién se conoce
  // cuando el usuario elige un proyecto o, sin proyecto, el selector de
  // Área — por eso se recalcula en cada render y se rellenan solo las
  // líneas que sigan vacías (nunca pisa una bodega ya elegida a mano).
  const areaEfectiva: 'ATT' | 'OyM' | null = fixedProject?.area ?? proyectoSeleccionado?.area ?? (necesitaArea ? areaSel : null)
  const defaultBodegaNombre = areaEfectiva ? BODEGA_DEFECTO_POR_AREA[areaEfectiva] : null
  const defaultBodegaId = defaultBodegaNombre ? bodegas.find((b) => b.nombre === defaultBodegaNombre)?.id ?? '' : ''
  // Con `fixedProject` el área nunca cambia, pero acá sí (el usuario recién
  // elige proyecto/área después de que ya se aplicó un primer default para
  // "sin proyecto") — no alcanza con "rellenar solo lo vacío": si no se
  // distingue "esto quedó así por el default anterior" de "el usuario lo
  // eligió a mano", el default viejo se queda pegado y el nuevo nunca entra
  // (confirmado en el navegador: creaba el proyecto ATT y la bodega seguía
  // en C132 porque ya se había rellenado con el default de OyM antes de
  // elegir proyecto). Se guarda cuál fue el último default aplicado y solo
  // se pisan las líneas que sigan vacías o que tengan exactamente ese valor.
  const lastDefaultApplied = useRef('')
  useEffect(() => {
    const prevDefault = lastDefaultApplied.current
    if (defaultBodegaId && defaultBodegaId !== prevDefault) {
      setLineas((prev) => prev.map((l) =>
        (!l.ubicacionBodegaId || l.ubicacionBodegaId === prevDefault) ? { ...l, ubicacionBodegaId: defaultBodegaId } : l,
      ))
      lastDefaultApplied.current = defaultBodegaId
    }
  }, [defaultBodegaId])
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
      case 'traslado_bodega': return { ubicacionId: l.ubicacionBodegaId || null, naturaleza: 'fisico', checkAvailability: true }
      case 'rebajado': return { ubicacionId: l.ubicacionBodegaId || null, naturaleza: 'digital', checkAvailability: true }
      case 'devuelto': return { ubicacionId: tecnicoUbicacionId, naturaleza: 'fisico', checkAvailability: true }
      case 'instalado': return { ubicacionId: tecnicoUbicacionId, naturaleza: 'fisico', checkAvailability: true }
      case 'merma': return { ubicacionId: tecnicoUbicacionId, naturaleza: 'fisico', checkAvailability: true }
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
    if (!esEntrada && !esTraslado) {
      if (requiereProyecto && !proyectoIdEfectivo) return 'Este tipo de movimiento requiere un proyecto'
      if (!tecnicoUserId) return 'Falta elegir el técnico'
    }
    for (const l of lineas) {
      if (!l.materialId) return 'Falta elegir material en alguna línea'
      const n = Number(l.cantidad)
      if (!l.cantidad || !(n > 0)) return 'Cantidad inválida en alguna línea'
      if (necesitaBodegaPorLinea && !l.ubicacionBodegaId) return 'Falta la bodega en alguna línea'
      if (necesitaBodegaDestinoPorLinea && !l.ubicacionBodegaDestinoId) return 'Falta la bodega de destino en alguna línea'
      if (necesitaBodegaDestinoPorLinea && l.ubicacionBodegaId && l.ubicacionBodegaId === l.ubicacionBodegaDestinoId) {
        return 'La bodega de origen y destino no pueden ser la misma'
      }
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
          ubicacionBodegaDestinoId: necesitaBodegaDestinoPorLinea ? l.ubicacionBodegaDestinoId : undefined,
          proveedor: esEntrada ? (proveedor.trim() || undefined) : undefined,
          documento: esEntrada ? (documento.trim() || undefined) : undefined,
          projectId: (esEntrada || esTraslado) ? undefined : (proyectoIdEfectivo ?? undefined),
          puntoId: esEntrada ? undefined : (puntos ? (puntoId || null) : undefined),
          tecnicoUserId: (esEntrada || esTraslado) ? undefined : tecnicoUserId,
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

      {!lockTipoUI && !fixedProject && !soloEntrada && (
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
            {!fixedProject && !esTraslado && (
              <label className="space-y-1 col-span-2">
                <span className={labelCls}>Proyecto</span>
                {!requiereProyecto && (
                  <button type="button" onClick={() => setProjectSel(projectSel === PREVENTIVA ? '' : PREVENTIVA)}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded-lg border mb-1 ${projectSel === PREVENTIVA ? 'bg-brand-900/40 border-brand-500 text-brand-300' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>
                    🅿️ Salida preventiva (sin proyecto)
                  </button>
                )}
                {projectSel !== PREVENTIVA && (
                  <ProyectoSelect proyectos={proyectos} value={projectSel} onChange={setProjectSel}
                    puedeCrear={puedeCrearProyecto}
                    onCreated={(nuevo) => setProyectos((prev) => [...prev, nuevo])}
                    className="w-full" />
                )}
              </label>
            )}
            {necesitaArea && (
              <label className="space-y-1 col-span-2">
                <span className={labelCls}>Área (insumos / salida preventiva)</span>
                <select value={areaSel} onChange={(e) => setAreaSel(e.target.value as 'ATT' | 'OyM')} className={`${inputCls} w-full`}>
                  <option value="ATT">ATT</option>
                  <option value="OyM">OyM (Preventivos/Incidencias)</option>
                </select>
              </label>
            )}
            {!esTraslado && (
            <label className="space-y-1 col-span-2">
              <span className={labelCls}>Técnico</span>
              <select value={tecnicoUserId} onChange={(e) => setTecnicoUserId(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">Elegir técnico…</option>
                {tecnicoOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            )}
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
        {/* Una fila por línea, mismo formato que Asignaciones. Las columnas de
            bodega son condicionales: solo los tipos que la piden por línea la
            muestran (Entrada la tiene una sola vez arriba, no por línea). */}
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 text-slate-400 text-left divide-x divide-slate-700">
                <th className="px-2 py-1.5 font-medium">Material</th>
                {necesitaBodegaPorLinea && (
                  <th className="px-2 py-1.5 font-medium">
                    {tipoUI === 'devuelto' ? 'Bodega destino' : 'Bodega origen'}
                  </th>
                )}
                {necesitaBodegaDestinoPorLinea && <th className="px-2 py-1.5 font-medium">Bodega destino</th>}
                <th className="px-2 py-1.5 font-medium">Lote</th>
                <th className="px-2 py-1.5 font-medium text-right">Cantidad</th>
                <th className="px-2 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const r = resultados[l.localId]
                const ctx = loteContexto(l)
                const totalCols = 4 + (necesitaBodegaPorLinea ? 1 : 0) + (necesitaBodegaDestinoPorLinea ? 1 : 0)
                // Ferretería no tiene lote físico distinguible — se omite el
                // selector SOLO del lado físico. En 'rebajado' (digital, SAP)
                // el lote sigue importando y el selector se mantiene siempre.
                const esFerreteriaFisico = ctx.naturaleza === 'fisico'
                  && esTipoFerreteria(materiales.find((m) => m.id === l.materialId)?.tipo?.nombre)
                const loteReset = (materialId: string) =>
                  esTipoFerreteria(materiales.find((m) => m.id === materialId)?.tipo?.nombre) ? LOTE_FISICO_FERRETERIA : ''
                return (
                  <Fragment key={l.localId}>
                    <tr className="border-t border-slate-800 divide-x divide-slate-800">
                      <td className="px-2 py-1.5 min-w-[12rem]">
                        <MaterialSelect materiales={materiales} value={l.materialId}
                          onChange={(id) => updateLinea(l.localId, { materialId: id, lote: loteReset(id) })} />
                      </td>
                      {necesitaBodegaPorLinea && (
                        <td className="px-2 py-1.5 min-w-[10rem]">
                          <UbicacionSelect value={l.ubicacionBodegaId}
                            onChange={(id) => updateLinea(l.localId, { ubicacionBodegaId: id, lote: loteReset(l.materialId) })}
                            tipo="bodega" placeholder={`Bodega de ${tipoUI === 'devuelto' ? 'destino' : 'origen'}…`}
                            className={`${inputCls} w-full`} />
                        </td>
                      )}
                      {necesitaBodegaDestinoPorLinea && (
                        <td className="px-2 py-1.5 min-w-[10rem]">
                          <UbicacionSelect value={l.ubicacionBodegaDestinoId} onChange={(id) => updateLinea(l.localId, { ubicacionBodegaDestinoId: id })}
                            tipo="bodega" placeholder="Bodega de destino…" className={`${inputCls} w-full`} />
                        </td>
                      )}
                      <td className="px-2 py-1.5 min-w-[9rem]">
                        {esFerreteriaFisico ? (
                          <span className="text-slate-400 text-xs">Físico</span>
                        ) : (
                          <LoteSelect materialId={l.materialId} ubicacionId={ctx.ubicacionId} naturaleza={ctx.naturaleza}
                            checkAvailability={ctx.checkAvailability} value={l.lote}
                            onChange={(lote) => updateLinea(l.localId, { lote })} className={`${inputCls} w-full`} />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" placeholder="0" value={l.cantidad}
                          onChange={(e) => updateLinea(l.localId, { cantidad: e.target.value })}
                          className={`${inputCls} w-20 text-right`} />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <button type="button" onClick={() => removeLinea(l.localId)} disabled={lineas.length === 1}
                          className="text-xs text-red-400 disabled:opacity-30">Quitar</button>
                      </td>
                    </tr>
                    {r && (
                      <tr className="border-t border-slate-800">
                        <td colSpan={totalCols} className={`px-2 pb-1.5 text-xs ${r.ok ? 'text-green-400' : 'text-red-400'}`}>{r.texto}</td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
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
