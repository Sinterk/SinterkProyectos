// Resumen de material de un proyecto en DOS tablas: la FÍSICA (solicitado/
// entregado/instalado/devuelto/merma/asignado a técnico/tránsito) y la
// DIGITAL (la baja contable de SAP, `TablaDigital` al final del archivo).
// Las dos se alimentan de las mismas filas de `proyecto_materiales`, así que
// una fila cargada en la física aparece sola en la digital con el mismo SKU
// y lote, y un solo "Guardar cambios" registra lo pendiente de ambas.
//
// Ambas son tablas con columnas fijas, editables por
// suma: cada celda editable registra un movimiento real (mismo camino que
// "Registrar movimiento" — atómico, respeta stock) en vez de sobreescribir
// el número directamente, así nunca se desincroniza del stock real. Por eso
// solo admite sumar cantidades, nunca restar: para corregir un exceso hay
// que registrar el movimiento contrario (ej. un Devuelto deshace una
// Entrega) — la función de la BD no permite cantidades negativas. Un solo
// clic en "Guardar cambios" registra todas las celdas editadas de una vez,
// una llamada (un movimiento) por celda.
//
// "+ Nuevo material" agrega una fila en blanco para dar de alta un material
// que el proyecto todavía no tiene: se elige SKU/lote ahí mismo y se llena
// como cualquier otra fila — reemplaza al formulario aparte de "Registrar
// movimiento" que vivía en LogisticaTab (ver ese archivo).

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import { nanoid } from '@/core/utils/nanoid'
import { reemplazarLineaPorVarias } from '@/core/utils/lineas'
import { BODEGA_DEFECTO_POR_AREA } from '@/lib/inventario/defaults'
import { calcularLineasRebaja, nuevoLibroStock } from '@/lib/inventario/calcularRebaja'
import { esTipoFerreteria, LOTE_FISICO_FERRETERIA } from '@/lib/inventario/esFerreteria'
import {
  getResumenProyecto, getStock, listMateriales, listUbicaciones,
  reasignarTransitoAPreventivo, registrarMovimiento,
} from '@/lib/inventario/inventarioRepo'
import type { Material, MovimientoTipoUI, ResumenMaterialProyecto, StockRow, Ubicacion } from '@/lib/inventario/types'
import { LoteSelect } from './LoteSelect'
import { MaterialSelect } from './MaterialSelect'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  area: 'ATT' | 'OyM'
  /** Solo se pasa para Preventivos: habilita el desglose "· <nombre del punto>" por fila. */
  puntos?: Punto[]
  /** Ver LogisticaTab: agrupa por material sin necesitar la lista de puntos. */
  agregarPuntos?: boolean
  refreshKey?: number
  /** Sube cuando `EquipoSection` (en LogisticaTab) agrega/quita un técnico — sin esto, esta tabla seguía mostrando la lista de técnicos vieja hasta salir y volver a entrar a la OTT. */
  membersVersion?: number
  /** Solo ATT las pasa — para el formato "Material digital" copiable al control de rebajas de Entel (ver TablaDigital). */
  ott?: string
  direccion?: string
  fechaInicio?: string
}

export function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className={`text-sm font-semibold ${highlight ? 'text-amber-400' : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  )
}

type Campo = 'cantSolicitada' | 'cantEntregada' | 'cantInstalada' | 'cantDevuelta' | 'cantRebajada' | 'cantMerma' | 'cantRezagada'
const CAMPOS: Campo[] = ['cantSolicitada', 'cantEntregada', 'cantInstalada', 'cantDevuelta', 'cantRebajada', 'cantMerma', 'cantRezagada']
/** `cantRezagada` no está acá: no se registra con `registrar_movimiento` sino
 *  con `reasignar_transito_a_preventivo` — ver `guardarCambios`. */
const CAMPO_TIPO: Partial<Record<Campo, MovimientoTipoUI>> = {
  cantSolicitada: 'solicitud', cantEntregada: 'entrega', cantInstalada: 'instalado',
  cantDevuelta: 'devuelto', cantRebajada: 'rebajado', cantMerma: 'merma',
}
/** Asignar a técnico (lo que antes era el botón "→ preventivo"): ahora es una
 *  celda editable más, pero su guardado va por otra RPC. */
const CAMPO_REASIGNACION: Campo = 'cantRezagada'
/** Campos cuyo movimiento requiere elegir bodega (origen para Entrega/Rebajado, destino para Devuelto). Merma, como Instalado, sale del stock propio del técnico — sin bodega. */
const CAMPO_NECESITA_BODEGA: Campo[] = ['cantEntregada', 'cantDevuelta', 'cantRebajada']

/**
 * Solo OyM: valores especiales del selector "Origen" de una fila (uno por
 * cada técnico asignado, `ORIGEN_TECNICO_PREFIX + userId`) que en realidad
 * significan "esta fila sale del stock que ESE técnico ya trae encima, no
 * de una bodega" — a diferencia de ATT, en OyM lo normal es que el material
 * YA esté con el técnico (asignación preventiva, ver AsignacionesForm)
 * antes de que exista la incidencia, así que Instalado no debería asumir
 * una bodega por defecto. Pedido explícito de Andrés: mantener que si el
 * técnico no tiene stock suficiente, Instalado igual se registra en
 * negativo desde el técnico (no se cae solo a bodega) — sacar derecho de
 * una bodega es una elección manual y explícita de esta fila, nunca
 * automática, "para que no haya sorpresas del motivo" por el que bajó el
 * stock de una bodega.
 *
 * Elegir uno de estos valores en "Origen" TAMBIÉN fija el selector de
 * Técnico de la fila a ese mismo técnico (y viceversa: cambiar el técnico
 * mientras el origen ya es "de técnico" actualiza el origen para que
 * apunte al nuevo) — son la misma decisión mostrada en dos lugares, pedido
 * explícito de Andrés para que nunca queden desincronizados. Con origen de
 * técnico elegido, Entregado se deshabilita en la fila (no tiene sentido:
 * no salió nada de ninguna bodega) y la opción de Origen de cada técnico
 * muestra cuánto tiene del material/lote de esa fila, para elegir de cuál
 * conviene sacarlo.
 */
const ORIGEN_TECNICO_PREFIX = '__origen_tecnico__:'
function esOrigenTecnico(v: string): boolean { return v.startsWith(ORIGEN_TECNICO_PREFIX) }
function origenTecnicoValue(userId: string): string { return ORIGEN_TECNICO_PREFIX + userId }
function origenTecnicoUserId(v: string): string { return v.slice(ORIGEN_TECNICO_PREFIX.length) }
/**
 * El material del proyecto se muestra en DOS tablas (pedido de Andrés):
 * la física (lo que se mueve de verdad) y la digital (la baja contable en
 * SAP). `cantRebajada` es la única columna digital — por eso sale de la
 * tabla física y vive en `TablaDigital`, más abajo. Ambas comparten el
 * mismo estado (`edits`) y las mismas filas de `proyecto_materiales`: por
 * eso una fila nueva cargada en la física aparece sola en la digital, con
 * el mismo SKU y lote.
 */
const CAMPOS_FISICOS: Campo[] = ['cantSolicitada', 'cantEntregada', 'cantInstalada', 'cantDevuelta', 'cantMerma', 'cantRezagada']
const CAMPO_DIGITAL: Campo = 'cantRebajada'

const NINGUN_PUNTO = ''
const TODOS_LOS_PUNTOS = ''

/**
 * Colapsa las filas (una por material+lote+punto) a una por material+lote,
 * sumando todo — incluido Instalado, que ahora se registra por punto (ver
 * PuntoMaterialSection) pero se ve como total acá por defecto. `puntoId`
 * queda null en el resultado: ya no representa un punto único.
 */
function agregarPorMaterial(rows: ResumenMaterialProyecto[]): ResumenMaterialProyecto[] {
  const map = new Map<string, ResumenMaterialProyecto>()
  // Al colapsar varios puntos en una fila, la bodega "real" ya no es una
  // sola — se toma la del punto con más Entregado como más representativa
  // (mismo criterio que dentro de un punto: la de mayor cantidad).
  const mejorEntregada = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.materialId}|${r.lote}`
    let acc = map.get(k)
    if (!acc) {
      acc = {
        materialId: r.materialId, materialSku: r.materialSku, materialDescripcion: r.materialDescripcion,
        lote: r.lote, puntoId: null,
        cantSolicitada: 0, cantEntregada: 0, cantInstalada: 0, cantDevuelta: 0, cantRezagada: 0, cantRebajada: 0,
        cantMerma: 0, cantTransito: 0, ubicacionBodegaId: null,
      }
      map.set(k, acc)
    }
    acc.cantSolicitada += r.cantSolicitada
    acc.cantEntregada += r.cantEntregada
    acc.cantInstalada += r.cantInstalada
    acc.cantDevuelta += r.cantDevuelta
    acc.cantRezagada += r.cantRezagada
    acc.cantRebajada += r.cantRebajada
    acc.cantMerma += r.cantMerma
    if (r.ubicacionBodegaId && r.cantEntregada > (mejorEntregada.get(k) ?? 0)) {
      mejorEntregada.set(k, r.cantEntregada)
      acc.ubicacionBodegaId = r.ubicacionBodegaId
    }
  }
  for (const acc of map.values()) {
    acc.cantTransito = acc.cantEntregada - acc.cantInstalada - acc.cantDevuelta - acc.cantRezagada - acc.cantMerma
  }
  return [...map.values()].sort((a, b) => a.materialSku.localeCompare(b.materialSku))
}

interface NuevaFila {
  localId: string
  materialId: string
  lote: string
  puntoId: string | null
  /** Por defecto el primer técnico asignado al proyecto — se elige en la misma fila, a la izquierda del SKU. */
  tecnicoUserId: string
  /** De dónde sale el material — por defecto la bodega del área (BODEGA_DEFECTO_POR_AREA). */
  ubicacionBodegaId: string
  /** Nota libre que se copia a los movimientos que registre esta fila. */
  nota: string
  edits: Partial<Record<Campo, string>>
}

function filaVacia(tecnicoUserId: string, ubicacionBodegaId: string): NuevaFila {
  return { localId: nanoid(8), materialId: '', lote: '', puntoId: null, tecnicoUserId, ubicacionBodegaId, nota: '', edits: {} }
}

/**
 * Una línea de rebaja pendiente (nueva, sin guardar todavía) — ver
 * `RebajaPendienteSection`. No está ligada a una fila física existente:
 * a diferencia del resto de la tabla, acá SÍ importa el lote real (SAP), así
 * que una sola necesidad de rebaja puede terminar en varias líneas (una por
 * lote consumido, ver `sugerirRebaja`).
 */
interface LineaRebaja {
  localId: string
  materialId: string
  materialSku: string
  materialDescripcion: string
  lote: string
  ubicacionBodegaId: string
  cantidad: string
  origen: 'auto' | 'manual'
}

export function ResumenProyectoTable({ projectId, area, puntos, agregarPuntos, refreshKey = 0, membersVersion = 0, ott, direccion, fechaInicio }: Props) {
  const rol = useAuth((s) => s.profile?.rol)
  // registrar_movimiento exige técnico para tipoUI='rebajado' (0005) — no
  // afecta stock de nadie ahí, es solo quién queda como usuario_id del
  // movimiento para trazabilidad. Una rebaja SAP la registra oficina/JP, no
  // un técnico puntual, así que se usa quien está guardando — sin pedirlo
  // en un selector aparte en RebajaPendienteSection.
  const currentUserId = useAuth((s) => s.session?.user.id)
  const puedeCorregir = rol === 'admin' || rol === 'jp' || rol === 'log'
  // El técnico solo reporta lo que instaló/devolvió — entregado/rebajado los
  // registra oficina (entrega física, rebaja SAP), y solicitado no es un
  // campo propio (se calcula solo). Candado de UI, no de RLS: la función
  // registrar_movimiento ya autoriza al técnico para cualquier tipoUI sobre
  // sus propios proyectos, igual que otros candados de este estilo en la app
  // (ver "auto-democión" del admin en AdminScreen/UserRow).
  const editableCampos: Campo[] = rol === 'tecnico' ? ['cantInstalada', 'cantDevuelta', 'cantMerma', 'cantRezagada'] : CAMPOS
  // Preventivos: por defecto la tabla muestra el total (Instalado = suma de
  // todos los puntos, ver agregarPorMaterial) — un punto específico filtra a
  // solo sus filas, y ahí Instalado vuelve a ser editable (mismo resultado
  // que agregar material desde la tarjeta del punto).
  const [puntoFiltro, setPuntoFiltro] = useState(TODOS_LOS_PUNTOS)
  const mostrandoTodosLosPuntos = (!!puntos && puntoFiltro === TODOS_LOS_PUNTOS) || (!puntos && !!agregarPuntos)
  const [rows, setRows] = useState<ResumenMaterialProyecto[] | null>(null)
  // Lo que la tabla realmente muestra/edita — agregado por defecto en
  // Preventivos, filtrado a un punto si se eligió uno; sin `puntos` (ATT/
  // Incidencias) es igual a `rows`. guardarCambios debe iterar ESTO, no
  // `rows` crudo, porque una fila agregada (puntoId null) puede no existir
  // tal cual en `rows` si todo lo entregado ya tiene punto.
  const displayRows = rows === null ? [] : (
    mostrandoTodosLosPuntos ? agregarPorMaterial(rows)
      : puntos ? rows.filter((r) => r.puntoId === puntoFiltro)
      : rows
  )
  const editableCamposVista: Campo[] = mostrandoTodosLosPuntos ? editableCampos.filter((c) => c !== 'cantInstalada') : editableCampos
  const [materiales, setMateriales] = useState<Material[]>([])
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
  // Solo OyM: stock propio de cada técnico asignado, para mostrar "(cantidad)"
  // junto a su nombre al elegir de dónde sale un Instalado (ver ORIGEN_TECNICO_PREFIX).
  const [ubicacionesTecnico, setUbicacionesTecnico] = useState<Ubicacion[]>([])
  const [stockTecnicos, setStockTecnicos] = useState<StockRow[]>([])
  const [error, setError] = useState<string | null>(null)

  // Edición por suma: `edits[rowKey][campo]` = cantidad a agregar, tecleada pero aún sin guardar.
  const [edits, setEdits] = useState<Record<string, Partial<Record<Campo, string>>>>({})
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({}) // key = `${rowKey}|${campo}`
  const [tecnicoEdicion, setTecnicoEdicion] = useState('')
  const [bodegaEdicion, setBodegaEdicion] = useState('')
  const [saving, setSaving] = useState(false)

  // Lote/técnico de una fila EXISTENTE también editables (antes solo se podían
  // elegir en "+ Nuevo material"): por defecto el lote propio de la fila y el
  // técnico compartido de la barra de abajo, pero se pueden cambiar antes de
  // guardar — sigue siendo aditivo (el "+" registra un movimiento nuevo con el
  // lote/técnico elegidos, no reescribe la fila existente), así que si se
  // elige un lote distinto simplemente aparece como fila propia tras recargar.
  const [rowLoteOverride, setRowLoteOverride] = useState<Record<string, string>>({})
  const [rowTecnicoOverride, setRowTecnicoOverride] = useState<Record<string, string>>({})
  // Antes la bodega de una fila existente no se veía ni se podía elegir —
  // "+" siempre usaba la bodega compartida de la barra de abajo (por defecto
  // la del área), sin importar si el material realmente estaba ahí. Bug real
  // encontrado por Andrés (OTT 72603674035): un material que no vivía en esa
  // bodega quedó en negativo porque nunca hubo forma de corregir de cuál
  // bodega salía por fila. Mismo patrón que lote/técnico: override por fila.
  const [rowBodegaOverride, setRowBodegaOverride] = useState<Record<string, string>>({})
  /** Nota libre por fila — se copia a cada movimiento que registre esa fila
   *  al guardar. Antes la nota solo se podía escribir desde "Registrar
   *  movimiento" en Inventario, no desde la tabla de la OTT, aunque la
   *  columna Nota sí se muestra en Movimientos. */
  const [rowNota, setRowNota] = useState<Record<string, string>>({})

  // Filas nuevas (materiales aún no presentes en `rows`): mismo mecanismo de
  // "+" que una fila existente, solo que además hay que elegir material/lote/
  // punto ahí mismo antes de poder guardar.
  const [nuevasFilas, setNuevasFilas] = useState<NuevaFila[]>([])

  async function reload() {
    try { setRows(await getResumenProyecto(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { setRows(null); reload() }, [projectId, refreshKey])
  useEffect(() => { adminRepo.listMembers(projectId).then(setMembers).catch(() => {}) }, [projectId, membersVersion])
  useEffect(() => { listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {}) }, [])
  useEffect(() => { listMateriales().then(setMateriales).catch(() => {}) }, [])
  useEffect(() => { if (area === 'OyM') listUbicaciones({ tipo: 'tecnico' }).then(setUbicacionesTecnico).catch(() => {}) }, [area])
  useEffect(() => {
    if (area !== 'OyM' || members.length === 0) { setStockTecnicos([]); return }
    const ubicIds = members
      .map((m) => ubicacionesTecnico.find((u) => u.ownerUserId === m.id)?.id)
      .filter((id): id is string => !!id)
    if (ubicIds.length === 0) { setStockTecnicos([]); return }
    let cancelado = false
    Promise.all(ubicIds.map((id) => getStock({ ubicacionId: id })))
      .then((lists) => { if (!cancelado) setStockTecnicos(lists.flat()) })
      .catch(() => { if (!cancelado) setStockTecnicos([]) })
    return () => { cancelado = true }
  }, [area, members, ubicacionesTecnico, refreshKey])

  /** Cuánto tiene AHORA un técnico de un material/lote en su stock propio (0 si no se sabe todavía). */
  function stockDeTecnico(userId: string, materialId: string, lote: string): number {
    const ubicId = ubicacionesTecnico.find((u) => u.ownerUserId === userId)?.id
    if (!ubicId || !materialId) return 0
    return stockTecnicos.find((s) => s.ubicacionId === ubicId && s.materialId === materialId && s.lote === lote)?.cantidadFisico ?? 0
  }
  /** Etiqueta del selector de Técnico — en OyM suma "(cantidad)" del material/lote de esa fila, para ver de cuál conviene sacarlo. */
  function tecnicoLabel(m: MemberProfile, materialId: string, lote: string): string {
    const nombre = m.nombre?.trim() || m.email || ''
    return area === 'OyM' && materialId ? `${nombre} (${stockDeTecnico(m.id, materialId, lote)})` : nombre
  }

  useEffect(() => { if (!tecnicoEdicion && members.length > 0) setTecnicoEdicion(members[0].id) }, [members, tecnicoEdicion])
  const defaultBodegaId = bodegas.find((b) => b.nombre === BODEGA_DEFECTO_POR_AREA[area])?.id ?? ''
  useEffect(() => { if (!bodegaEdicion && defaultBodegaId) setBodegaEdicion(defaultBodegaId) }, [defaultBodegaId, bodegaEdicion])

  const rowKey = (r: ResumenMaterialProyecto) => `${r.materialId}|${r.lote}|${r.puntoId ?? ''}`

  function setDraft(key: string, campo: Campo, v: string) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: v } }))
  }

  function getRowLote(row: ResumenMaterialProyecto): string {
    return rowLoteOverride[rowKey(row)] ?? row.lote
  }
  function setRowLote(key: string, lote: string) {
    setRowLoteOverride((prev) => ({ ...prev, [key]: lote }))
  }
  function getRowTecnico(key: string): string {
    return rowTecnicoOverride[key] || tecnicoEdicion
  }
  function setRowTecnico(key: string, tecnicoUserId: string) {
    setRowTecnicoOverride((prev) => ({ ...prev, [key]: tecnicoUserId }))
  }
  // Antes de un override manual, parte en la bodega REAL de donde salió el
  // material (`row.ubicacionBodegaId`, derivada de los movimientos de
  // Entrega — ver getResumenProyecto) en vez de siempre el default del área
  // — bug real reportado por Andrés: al reabrir la OTT, una fila entregada
  // desde otra bodega igual mostraba C088 (el override solo vivía en
  // estado de React, se perdía al recargar). Sin entregas todavía
  // (`ubicacionBodegaId` null), sigue cayendo al default del área.
  function getRowBodega(row: ResumenMaterialProyecto): string {
    return rowBodegaOverride[rowKey(row)] || row.ubicacionBodegaId
      || (area === 'OyM' ? origenTecnicoValue(getRowTecnico(rowKey(row))) : bodegaEdicion)
  }
  function setRowBodega(key: string, ubicacionBodegaId: string) {
    setRowBodegaOverride((prev) => ({ ...prev, [key]: ubicacionBodegaId }))
    // La bodega elegida gobierna qué lotes hay disponibles — un lote ya
    // elegido para la bodega anterior puede no existir en la nueva.
    setRowLoteOverride((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function agregarFilaNueva() {
    setNuevasFilas((prev) => [...prev, filaVacia(members[0]?.id ?? '', area === 'OyM' ? origenTecnicoValue(members[0]?.id ?? '') : defaultBodegaId)])
  }
  function actualizarFilaNueva(localId: string, patch: Partial<Pick<NuevaFila, 'materialId' | 'lote' | 'puntoId' | 'tecnicoUserId' | 'ubicacionBodegaId' | 'nota'>>) {
    setNuevasFilas((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)))
  }

  // Al elegir material para una fila nueva, la bodega parte en la bodega por
  // defecto del área (C088/C132) — pero SOLO si el SKU ya tiene algo de
  // stock digital registrado en alguna bodega (es un material real que ya
  // pasó por SAP). Si nunca se movió digitalmente, asumir que vive en la
  // bodega del área es adivinar; se deja sin bodega para que el usuario
  // elija a mano (pedido de Andrés).
  //
  // Además, si no tiene stock en esa bodega pero sí en otra (ej. un
  // material de OyM elegido desde una OTT ATT, o de la bodega Insumos), la
  // fila saltaba una "salida" de una bodega donde el material nunca estuvo,
  // generando negativos falsos. Se corrige buscando dónde el material
  // realmente tiene stock y saltando la bodega de la fila para allá — esto
  // sigue aplicando aunque no tenga stock digital, con tal de que tenga
  // stock FÍSICO en alguna bodega.
  async function handleMaterialSeleccionado(fila: NuevaFila, materialId: string) {
    // Ferretería no tiene lote físico distinguible — se fija directo, sin
    // pasar por el selector (ver esFerreteria.ts).
    const esFerreteria = esTipoFerreteria(materiales.find((m) => m.id === materialId)?.tipo?.nombre)
    actualizarFilaNueva(fila.localId, { materialId, lote: esFerreteria ? LOTE_FISICO_FERRETERIA : '' })
    if (!materialId) return
    // Origen "técnico" (solo OyM): no hay bodega que autodetectar, el
    // material sale del stock propio del técnico elegido en la fila.
    if (esOrigenTecnico(fila.ubicacionBodegaId)) return
    try {
      const stockRows = await getStock({ materialId })
      const bodegaIds = new Set(bodegas.map((b) => b.id))
      const enBodegas = stockRows.filter((s) => bodegaIds.has(s.ubicacionId))

      const tieneStockDigital = enBodegas.some((s) => s.cantidadDigital > 0)
      let bodegaActual = fila.ubicacionBodegaId
      if (!tieneStockDigital && bodegaActual) {
        bodegaActual = ''
        actualizarFilaNueva(fila.localId, { ubicacionBodegaId: '' })
      }

      const tieneStockActual = enBodegas.some((s) => s.ubicacionId === bodegaActual && (s.cantidadFisico > 0 || s.cantidadDigital > 0))
      if (tieneStockActual) return
      const mejor = [...enBodegas].sort((a, b) => (b.cantidadFisico + b.cantidadDigital) - (a.cantidadFisico + a.cantidadDigital))[0]
      if (mejor && (mejor.cantidadFisico > 0 || mejor.cantidadDigital > 0) && mejor.ubicacionId !== bodegaActual) {
        actualizarFilaNueva(fila.localId, { ubicacionBodegaId: mejor.ubicacionId })
      }
    } catch {
      // silencioso: el usuario igual puede elegir la bodega a mano si esto falla
    }
  }
  function setDraftNueva(localId: string, campo: Campo, v: string) {
    setNuevasFilas((prev) => prev.map((f) => (f.localId === localId ? { ...f, edits: { ...f.edits, [campo]: v } } : f)))
  }
  function quitarFilaNueva(localId: string) {
    setNuevasFilas((prev) => prev.filter((f) => f.localId !== localId))
  }
  /**
   * Paquete de materiales elegido en la fila `fila` (ver MaterialSelect →
   * onSelectPaquete): la reemplaza por una fila nueva por cada SKU, todas
   * SIN ninguna cantidad tecleada (Solicitado/Entregado/etc. quedan vacíos,
   * el usuario los completa a mano por fila). Cada una pasa por
   * `handleMaterialSeleccionado` para heredar el mismo auto-detectado de
   * bodega que una fila agregada a mano.
   */
  async function handlePaqueteSeleccionado(fila: NuevaFila, materialIds: string[]) {
    if (materialIds.length === 0) return
    const nuevas = materialIds.map((_, i) => (i === 0 ? fila : filaVacia(fila.tecnicoUserId, fila.ubicacionBodegaId)))
    setNuevasFilas((prev) => reemplazarLineaPorVarias(prev, fila.localId, nuevas))
    for (let i = 0; i < materialIds.length; i++) {
      await handleMaterialSeleccionado(nuevas[i], materialIds[i])
    }
  }

  // Rebaja pendiente (Material digital / SAP) — ver RebajaPendienteSection.
  const [lineasRebaja, setLineasRebaja] = useState<LineaRebaja[]>([])
  const [sugiriendo, setSugiriendo] = useState(false)

  function agregarLineaRebajaManual() {
    setLineasRebaja((prev) => [...prev, {
      localId: nanoid(8), materialId: '', materialSku: '', materialDescripcion: '',
      lote: '', ubicacionBodegaId: bodegaEdicion, cantidad: '', origen: 'manual',
    }])
  }
  function actualizarLineaRebaja(localId: string, patch: Partial<LineaRebaja>) {
    setLineasRebaja((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)))
  }
  function quitarLineaRebaja(localId: string) {
    setLineasRebaja((prev) => prev.filter((l) => l.localId !== localId))
  }
  /** Paquete de materiales elegido en la línea `localId` — mismo mecanismo que en el resto del formulario. */
  function agregarPaqueteRebaja(localId: string, materialIds: string[]) {
    setLineasRebaja((prev) => {
      const actual = prev.find((l) => l.localId === localId)
      const base = actual ?? { localId, materialId: '', materialSku: '', materialDescripcion: '', lote: '', ubicacionBodegaId: bodegaEdicion, cantidad: '', origen: 'manual' as const }
      const nuevas = materialIds.map((materialId) => {
        const m = materiales.find((mm) => mm.id === materialId)
        return { ...base, localId: nanoid(8), materialId, materialSku: m?.sku ?? '', materialDescripcion: m?.descripcion ?? '', lote: '', cantidad: '' }
      })
      return reemplazarLineaPorVarias(prev, localId, nuevas)
    })
  }

  /**
   * Recalcula las líneas `origen:'auto'` de rebaja pendiente, preservando
   * las `manual` que ya se hayan agregado (mismo patrón que "Regenerar
   * avance" del Estado de Pago: botón, no automático).
   *
   * Solo mira la bodega del área (C088 en ATT, C132 en OyM —
   * `defaultBodegaId`) — nunca otras. Antes, si esa bodega no tenía stock
   * digital suficiente, se seguía buscando en el resto de las bodegas; eso
   * quedó mal (bug real reportado por Andrés): la rebaja terminaba
   * proponiendo un lote de una bodega que no tiene nada que ver con el
   * proyecto, en vez de simplemente avisar que no hay stock digital ahí.
   * Ahora, si no alcanza en la bodega del área, la línea queda con el
   * faltante y sin lote — para completar a mano, nunca "resuelta" con un
   * lote ajeno.
   *
   * CABLE es un caso aparte (pedido explícito de Andrés) — nunca se reparte
   * entre varios lotes:
   *   - Si el físico YA tiene un lote real (no 'SinDefinir'), la rebaja va
   *     contra ESE MISMO lote en la bodega del área, siempre, sin buscar ni
   *     comparar disponible — es de ahí de donde salió de verdad. El
   *     digital ya permite negativo (0055), así que no hace falta que
   *     "alcance" para usarlo.
   *   - Si el físico todavía no tiene lote, se busca UN lote digital (en la
   *     bodega del área) que cubra toda la cantidad — nunca varios. Si
   *     ninguno alcanza solo, queda una línea sin lote con el total, para
   *     completar a mano.
   * Cable tampoco se agrupa por material entre lotes distintos: cada fila
   * física (material+lote) es su propia línea de rebaja.
   *
   * Todo lo demás: se agrupa por material (sin importar el lote físico) y
   * se reparte entre los lotes digitales de la bodega del área, de MENOR a
   * MAYOR cantidad. Si ni sumando todos alcanza, la línea final queda con
   * el faltante y sin lote.
   */
  async function sugerirRebaja() {
    setError(null)
    setSugiriendo(true)
    try {
      // El cálculo (reglas de lote/bodega/cable) vive en calcularRebaja.ts,
      // compartido con la rebaja masiva de incidencias OyM.
      const calculadas = await calcularLineasRebaja({
        rows: displayRows, materiales, bodegaId: defaultBodegaId, libro: nuevoLibroStock(),
      })
      const auto: LineaRebaja[] = calculadas.map((c) => ({
        localId: nanoid(8), materialId: c.materialId, materialSku: c.materialSku, materialDescripcion: c.materialDescripcion,
        lote: c.lote, ubicacionBodegaId: c.ubicacionBodegaId, cantidad: String(c.cantidad), origen: 'auto',
      }))
      setLineasRebaja((prev) => [...auto, ...prev.filter((l) => l.origen === 'manual')])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSugiriendo(false)
    }
  }

  const pendientesExistentes = Object.values(edits).flatMap((byCampo) =>
    Object.values(byCampo).filter((v) => v && Number(v) > 0))
  const pendientesNuevas = nuevasFilas.flatMap((f) => Object.values(f.edits).filter((v) => v && Number(v) > 0))
  const pendientesRebaja = lineasRebaja.flatMap((l) => (l.cantidad && Number(l.cantidad) > 0 ? [l.cantidad] : []))
  const pendientes = [...pendientesExistentes, ...pendientesNuevas, ...pendientesRebaja]
  const hayPendientes = pendientes.length > 0

  /**
   * Registra un movimiento físico de una fila. Excepción OyM (pedido de
   * Andrés): con origen = una bodega real, el Instalado saca el material de
   * ESA bodega directamente — antes el Instalado siempre descontaba del stock
   * del técnico, así que desde una bodega solo se podía Entregar. Se registra
   * primero una Entrega de esa misma cantidad (bodega → técnico) y luego el
   * Instalado, que consume justo lo recién entregado: la bodega baja, el
   * técnico queda igual y el proyecto suma Entregado e Instalado. Con origen
   * técnico (o sin origen) y en ATT no cambia nada.
   */
  async function registrarCampoFisico(a: {
    campo: Campo; materialId: string; cantidad: number; lote?: string; puntoId: string | null
    tecnicoUserId: string; bodegaId: string; nota?: string
  }) {
    const desdeBodega = area === 'OyM' && a.campo === 'cantInstalada' && !!a.bodegaId
    let entregada = false
    try {
      if (desdeBodega) {
        await registrarMovimiento({
          tipoUI: 'entrega', materialId: a.materialId, cantidad: a.cantidad, lote: a.lote,
          projectId, puntoId: a.puntoId, tecnicoUserId: a.tecnicoUserId, ubicacionBodegaId: a.bodegaId, nota: a.nota,
        })
        entregada = true
      }
      await registrarMovimiento({
        tipoUI: CAMPO_TIPO[a.campo]!, materialId: a.materialId, cantidad: a.cantidad, lote: a.lote,
        projectId, puntoId: a.puntoId, tecnicoUserId: a.tecnicoUserId,
        ubicacionBodegaId: CAMPO_NECESITA_BODEGA.includes(a.campo) ? a.bodegaId : undefined,
        nota: a.nota,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(entregada
        ? `La entrega desde la bodega quedó registrada, pero falló el Instalado (${msg}). Reintenta con origen = técnico.`
        : msg)
    }
  }

  async function guardarCambios() {
    if (!rows) return
    setSaving(true)
    setError(null)
    const nextEdits: typeof edits = {}
    const nextErrors: Record<string, string> = {}
    for (const row of displayRows) {
      const key = rowKey(row)
      const byCampo = edits[key]
      if (!byCampo) continue
      const loteFila = getRowLote(row)
      const tecnicoFila = getRowTecnico(key)
      if (!tecnicoFila) {
        for (const campo of CAMPOS_FISICOS) {
          const raw = byCampo[campo]
          if (raw && Number(raw) > 0) nextEdits[key] = { ...nextEdits[key], [campo]: raw }
        }
        if (nextEdits[key]) nextErrors[`${key}|__tecnico__`] = 'Elige un técnico antes de guardar'
        continue
      }
      // CAMPO_DIGITAL (cantRebajada) queda afuera a propósito: registrar
      // nueva rebaja ya no pasa por esta tabla, ver RebajaPendienteSection.
      for (const campo of CAMPOS_FISICOS) {
        const raw = byCampo[campo]
        const n = Number(raw)
        if (!raw || !(n > 0)) continue
        // Origen de técnico (ver ORIGEN_TECNICO_PREFIX): no es una bodega
        // real. Un Devuelto desde ahí siempre vuelve a la bodega del área
        // (C132 en OyM) — es la única bodega que tiene sentido para "el
        // técnico devuelve lo que traía". Cualquier otro campo que necesite
        // bodega (en la práctica solo Entregado, que la UI ya deshabilita
        // en esta fila) queda sin bodega y cae al error normal de abajo.
        let bodegaFila = getRowBodega(row)
        if (esOrigenTecnico(bodegaFila)) bodegaFila = campo === 'cantDevuelta' ? defaultBodegaId : ''
        if (CAMPO_NECESITA_BODEGA.includes(campo) && !bodegaFila) {
          nextErrors[`${key}|${campo}`] = 'Falta elegir bodega'
          nextEdits[key] = { ...nextEdits[key], [campo]: raw }
          continue
        }
        // Guarda contra el caso que dejó un Tránsito en −1: asignar al técnico
        // más de lo que realmente quedó en tránsito. Si el número está mal por
        // otra razón, se arregla con el modo corrección (ver 0052).
        if (campo === CAMPO_REASIGNACION && n > row.cantTransito) {
          nextErrors[`${key}|${campo}`] = `No puedes asignar más de lo que hay en tránsito (${row.cantTransito})`
          nextEdits[key] = { ...nextEdits[key], [campo]: raw }
          continue
        }
        try {
          if (campo === CAMPO_REASIGNACION) {
            // "Asignado a técnico" no es un movimiento común: el material ya
            // está físicamente con el técnico desde la entrega, esto solo
            // cierra la parte del proyecto (reemplaza al botón "→ preventivo").
            await reasignarTransitoAPreventivo({
              projectId, materialId: row.materialId, lote: loteFila, puntoId: row.puntoId,
              tecnicoUserId: tecnicoFila, cantidad: n,
            })
          } else {
            await registrarCampoFisico({
              campo, materialId: row.materialId, cantidad: n, lote: loteFila || undefined,
              puntoId: row.puntoId, tecnicoUserId: tecnicoFila, bodegaId: bodegaFila,
              nota: rowNota[key]?.trim() || undefined,
            })
          }
        } catch (err) {
          nextErrors[`${key}|${campo}`] = err instanceof Error ? err.message : String(err)
          nextEdits[key] = { ...nextEdits[key], [campo]: raw }
        }
      }
    }

    const nextNuevasFilas: NuevaFila[] = []
    for (const fila of nuevasFilas) {
      const teniaEdits = Object.values(fila.edits).some((v) => v && Number(v) > 0)
      if (!teniaEdits) { nextNuevasFilas.push(fila); continue } // nada que guardar, se mantiene tal cual
      if (!fila.materialId) {
        nextErrors[`${fila.localId}|__material__`] = 'Elige un material antes de guardar'
        nextNuevasFilas.push(fila)
        continue
      }
      if (!fila.tecnicoUserId) {
        nextErrors[`${fila.localId}|__tecnico__`] = 'Elige un técnico antes de guardar'
        nextNuevasFilas.push(fila)
        continue
      }
      const nextFilaEdits: Partial<Record<Campo, string>> = {}
      for (const campo of CAMPOS) {
        // Una fila nueva todavía no tiene nada entregado que reasignar — esa
        // celda se muestra vacía y no se guarda (ver el render más abajo).
        if (campo === CAMPO_REASIGNACION) continue
        const raw = fila.edits[campo]
        const n = Number(raw)
        if (!raw || !(n > 0)) continue
        // Mismo criterio que en la tabla de filas existentes (ver más arriba): origen "técnico" → Devuelto va a la bodega del área, el resto queda sin bodega.
        let bodegaFila = fila.ubicacionBodegaId
        if (esOrigenTecnico(bodegaFila)) bodegaFila = campo === 'cantDevuelta' ? defaultBodegaId : ''
        if (CAMPO_NECESITA_BODEGA.includes(campo) && !bodegaFila) {
          nextErrors[`${fila.localId}|${campo}`] = 'Falta elegir bodega'
          nextFilaEdits[campo] = raw
          continue
        }
        try {
          await registrarCampoFisico({
            campo, materialId: fila.materialId, cantidad: n, lote: fila.lote || undefined,
            puntoId: fila.puntoId, tecnicoUserId: fila.tecnicoUserId, bodegaId: bodegaFila,
            nota: fila.nota.trim() || undefined,
          })
        } catch (err) {
          nextErrors[`${fila.localId}|${campo}`] = err instanceof Error ? err.message : String(err)
          nextFilaEdits[campo] = raw
        }
      }
      if (Object.keys(nextFilaEdits).length > 0) nextNuevasFilas.push({ ...fila, edits: nextFilaEdits })
      // si quedó sin edits pendientes, el material ya aparece como fila real tras el reload() — se descarta el borrador.
    }

    const nextLineasRebaja: LineaRebaja[] = []
    for (const linea of lineasRebaja) {
      const n = Number(linea.cantidad)
      if (!linea.cantidad || !(n > 0)) { nextLineasRebaja.push(linea); continue }
      if (!linea.materialId) {
        nextErrors[`${linea.localId}|__material__`] = 'Elige un material'
        nextLineasRebaja.push(linea)
        continue
      }
      if (!linea.ubicacionBodegaId) {
        nextErrors[`${linea.localId}|__bodega__`] = 'Falta elegir bodega'
        nextLineasRebaja.push(linea)
        continue
      }
      try {
        await registrarMovimiento({
          tipoUI: 'rebajado', materialId: linea.materialId, cantidad: n,
          lote: linea.lote.trim() || undefined, projectId, ubicacionBodegaId: linea.ubicacionBodegaId,
          tecnicoUserId: currentUserId,
        })
        // Éxito: la línea se descarta — tras el reload() el material rebajado
        // ya aparece con su número actualizado en la tabla digital de arriba.
      } catch (err) {
        nextErrors[`${linea.localId}|__cantidad__`] = err instanceof Error ? err.message : String(err)
        nextLineasRebaja.push(linea)
      }
    }
    setLineasRebaja(nextLineasRebaja)

    setEdits(nextEdits)
    setNuevasFilas(nextNuevasFilas)
    setCellErrors(nextErrors)
    // La nota se limpia junto con lo que sí se guardó: si quedara pegada,
    // el próximo movimiento de esa fila saldría con una nota vieja sin que
    // nadie se dé cuenta. Las filas que fallaron conservan la suya para el
    // reintento.
    setRowNota((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) if (!nextEdits[k]) delete next[k]
      return next
    })
    setSaving(false)
    await reload()
  }

  function descartarCambios() {
    setEdits({})
    setCellErrors({})
    setNuevasFilas((prev) => prev.map((f) => ({ ...f, edits: {} })))
    setLineasRebaja([])
  }

  const selectCls = 'bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const hayFilas = displayRows.length > 0 || nuevasFilas.length > 0

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material</h2>
        <div className="flex items-center gap-2">
          {puntos && (
            <select value={puntoFiltro}
              onChange={(e) => setPuntoFiltro(e.target.value)}
              className="text-[10px] bg-slate-700 text-white rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
              <option value={TODOS_LOS_PUNTOS}>Punto: Todos (total)</option>
              {puntos.map((p) => <option key={p.id} value={p.id}>Punto: {p.nombre || '—'}</option>)}
            </select>
          )}
          {puedeCorregir && (
            <button type="button" onClick={agregarFilaNueva}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg text-brand-400 hover:bg-slate-700">
              ➕ Nuevo material
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {rows === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : !hayFilas ? (
        <p className="text-xs text-slate-500">Sin movimientos de material todavía.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            {/* border-separate (no border-collapse): la columna fija
                (Descripción) usaba position:sticky sobre una tabla con
                border-collapse, una combinación con bugs conocidos de
                pintado en varios navegadores — Andrés lo vio en su celular
                como contenido "transparente" asomando detrás del texto fijo.
                Con bordes separados el fondo sólido de la celda sticky pinta
                de forma confiable. Como contrapartida, un <tr> ya no puede
                tener su propio `border` (no se pinta en modo "separate") —
                el borde entre filas se simula con `shadow-[inset...]` en vez
                de `border-t`, que sí funciona en cualquier modo. */}
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                  {/* Descripción fija a la izquierda (sticky): al escrollear para
                      llegar a Solicitado/Entregado/etc. antes se perdía de vista
                      qué material era esa fila — pedido de Andrés, probado en
                      celular. Técnico se movió al final ("al fondo a la
                      derecha") porque no hace falta verlo mientras se tipean
                      números, a diferencia del material. */}
                  <th className="px-2 py-2 font-medium sticky left-0 z-10 bg-slate-900 w-20 max-w-[5rem] isolate">
                    <span className="block truncate w-20">Descripción</span>
                  </th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">SKU</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">{area === 'OyM' ? 'Origen' : 'Bodega'}</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Lote</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Solicitado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Entregado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Instalado</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Devuelto</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Merma</th>
                  {/* `cant_rezagada` — lo que se dejó como preventivo al cerrar
                      (botón "→ preventivo"). Antes no se mostraba en ninguna
                      parte y era un término invisible de la fórmula de
                      Tránsito: Andrés vio un −1 sin ningún movimiento que lo
                      explicara. "Asignado a técnico" es el nombre que él pidió,
                      más claro que "rezagado". */}
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Asignado a técnico</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Tránsito</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Nota</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Técnico</th>
                </tr>
              </thead>
              <tbody>
                {nuevasFilas.map((fila) => {
                  const errMaterial = cellErrors[`${fila.localId}|__material__`]
                  const errTecnico = cellErrors[`${fila.localId}|__tecnico__`]
                  const esFerreteriaFila = esTipoFerreteria(materiales.find((m) => m.id === fila.materialId)?.tipo?.nombre)
                  return (
                    <tr key={fila.localId} className="shadow-[inset_0_1px_0_0_#334155] divide-x divide-slate-700 bg-brand-950/20">
                      <td className="px-2 py-2 w-20 max-w-[5rem] align-top sticky left-0 z-10 bg-brand-950 isolate">
                        <p className="text-slate-400 truncate w-20" title={materiales.find((m) => m.id === fila.materialId)?.descripcion ?? ''}>
                          {materiales.find((m) => m.id === fila.materialId)?.descripcion ?? ''}
                        </p>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <MaterialSelect materiales={materiales} value={fila.materialId}
                          onChange={(id) => { handleMaterialSeleccionado(fila, id).catch(() => {}) }}
                          onSelectPaquete={(materialIds) => { handlePaqueteSeleccionado(fila, materialIds).catch(() => {}) }}
                          className="w-36" />
                        {errMaterial && <p className="text-[9px] text-red-400 mt-0.5">{errMaterial}</p>}
                      </td>
                      <td className="px-2 py-2 align-top space-y-1">
                        <select value={fila.ubicacionBodegaId}
                          onChange={(e) => {
                            const v = e.target.value
                            actualizarFilaNueva(fila.localId, {
                              ubicacionBodegaId: v,
                              // Elegir el origen de un técnico también fija el
                              // selector de Técnico de la fila a ese mismo
                              // técnico — son la misma decisión (ver ORIGEN_TECNICO_PREFIX).
                              tecnicoUserId: esOrigenTecnico(v) ? origenTecnicoUserId(v) : fila.tecnicoUserId,
                              lote: esFerreteriaFila ? LOTE_FISICO_FERRETERIA : '',
                            })
                          }}
                          className="w-32 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">{area === 'OyM' ? 'Origen…' : 'Bodega…'}</option>
                          {area === 'OyM' && members.map((m) => (
                            <option key={m.id} value={origenTecnicoValue(m.id)}>👤 {tecnicoLabel(m, fila.materialId, fila.lote)}</option>
                          ))}
                          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                        </select>
                        {puntos && (
                          <select value={fila.puntoId ?? NINGUN_PUNTO}
                            onChange={(e) => actualizarFilaNueva(fila.localId, { puntoId: e.target.value || null })}
                            className="w-24 bg-slate-700 text-white text-[10px] rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
                            <option value={NINGUN_PUNTO}>Sin punto</option>
                            {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {esFerreteriaFila ? (
                          <span className="text-slate-400 text-xs">Físico</span>
                        ) : (
                          <LoteSelect materialId={fila.materialId} ubicacionId={esOrigenTecnico(fila.ubicacionBodegaId) ? null : (fila.ubicacionBodegaId || null)} naturaleza="fisico"
                            checkAvailability={false} value={fila.lote}
                            onChange={(lote) => actualizarFilaNueva(fila.localId, { lote })}
                            className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                        )}
                      </td>
                      {CAMPOS_FISICOS.map((campo) => {
                        // "Asignado a técnico" no aplica a una fila nueva: no hay
                        // nada entregado todavía que se pueda reasignar. Entregado
                        // tampoco aplica con origen "técnico": no sale nada de
                        // ninguna bodega en esta fila (ver ORIGEN_TECNICO_PREFIX).
                        const origenTecnico = esOrigenTecnico(fila.ubicacionBodegaId) && campo === 'cantEntregada'
                        if (campo === CAMPO_REASIGNACION || !editableCampos.includes(campo) || origenTecnico) {
                          return (
                            <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top text-slate-600"
                              title={origenTecnico ? 'Origen de esta fila: técnico — no sale nada de bodega' : undefined}>—</td>
                          )
                        }
                        const err = cellErrors[`${fila.localId}|${campo}`]
                        return (
                          <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                            <input type="number" min="0" step="any" placeholder="0" value={fila.edits[campo] ?? ''}
                              onChange={(e) => setDraftNueva(fila.localId, campo, e.target.value)}
                              className="w-14 bg-slate-700 text-white text-xs rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none text-center" />
                            {err && <p className="text-[9px] text-red-400 mt-0.5">{err}</p>}
                          </td>
                        )
                      })}
                      <td className="px-2 py-2 text-center align-top">
                        <button type="button" onClick={() => quitarFilaNueva(fila.localId)}
                          className="text-[10px] text-slate-500 hover:text-red-400">✕ Quitar</button>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input value={fila.nota} onChange={(e) => actualizarFilaNueva(fila.localId, { nota: e.target.value })}
                          placeholder="Nota…"
                          className="w-32 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select value={fila.tecnicoUserId}
                          onChange={(e) => {
                            const v = e.target.value
                            actualizarFilaNueva(fila.localId, {
                              tecnicoUserId: v,
                              // Si el origen de esta fila ya es "de técnico", cambiar
                              // el técnico acá también mueve el origen al nuevo.
                              ubicacionBodegaId: esOrigenTecnico(fila.ubicacionBodegaId) ? origenTecnicoValue(v) : fila.ubicacionBodegaId,
                            })
                          }}
                          className="w-28 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">Técnico…</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{tecnicoLabel(m, fila.materialId, fila.lote)}</option>)}
                        </select>
                        {errTecnico && <p className="text-[9px] text-red-400 mt-0.5">{errTecnico}</p>}
                      </td>
                    </tr>
                  )
                })}
                {displayRows.map((row) => {
                  const key = rowKey(row)
                  const draft = edits[key] ?? {}
                  const errTecnicoFila = cellErrors[`${key}|__tecnico__`]
                  const esFerreteriaFila = esTipoFerreteria(materiales.find((m) => m.id === row.materialId)?.tipo?.nombre)
                  return (
                    <tr key={key} className="shadow-[inset_0_1px_0_0_#334155] divide-x divide-slate-700 bg-slate-800/60">
                      <td className="px-2 py-2 w-20 max-w-[5rem] sticky left-0 z-10 bg-slate-800 isolate">
                        <p className="text-white truncate w-20" title={row.materialDescripcion}>{row.materialDescripcion}</p>
                      </td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{row.materialSku}</td>
                      <td className="px-2 py-2 align-top">
                        <select value={getRowBodega(row)}
                          onChange={(e) => {
                            const v = e.target.value
                            setRowBodega(key, v)
                            // Elegir el origen de un técnico también fija el
                            // selector de Técnico de la fila a ese mismo
                            // técnico — son la misma decisión (ver ORIGEN_TECNICO_PREFIX).
                            if (esOrigenTecnico(v)) setRowTecnico(key, origenTecnicoUserId(v))
                          }}
                          className="w-32 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">{area === 'OyM' ? 'Origen…' : 'Bodega…'}</option>
                          {area === 'OyM' && members.map((m) => (
                            <option key={m.id} value={origenTecnicoValue(m.id)}>👤 {tecnicoLabel(m, row.materialId, getRowLote(row))}</option>
                          ))}
                          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top space-y-1">
                        {esFerreteriaFila ? (
                          <span className="text-slate-400 text-xs">Físico</span>
                        ) : (
                          <LoteSelect materialId={row.materialId} ubicacionId={esOrigenTecnico(getRowBodega(row)) ? null : (getRowBodega(row) || null)} naturaleza="fisico"
                            checkAvailability={false} value={getRowLote(row)}
                            onChange={(lote) => setRowLote(key, lote)}
                            className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                        )}
                      </td>
                      {CAMPOS_FISICOS.map((campo) => {
                        const valor = row[campo]
                        if (!editableCamposVista.includes(campo)) {
                          return (
                            <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                              <span className="text-white font-medium">{valor}</span>
                            </td>
                          )
                        }
                        const err = cellErrors[`${key}|${campo}`]
                        // Entregado no aplica con origen "técnico": no sale nada de
                        // bodega en esta fila (ver ORIGEN_TECNICO_PREFIX) — se deja ver el
                        // total histórico, pero sin poder sumarle más acá.
                        const origenTecnico = campo === 'cantEntregada' && esOrigenTecnico(getRowBodega(row))
                        return (
                          <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-white font-medium">{valor}</span>
                              {origenTecnico ? (
                                <span className="text-slate-600 text-[10px]" title="Origen de esta fila: técnico — no sale nada de bodega">🔒</span>
                              ) : (
                                <>
                                  <span className="text-slate-500 text-[10px]">+</span>
                                  <input type="number" min="0" step="any" placeholder="0" value={draft[campo] ?? ''}
                                    onChange={(e) => setDraft(key, campo, e.target.value)}
                                    className="w-12 bg-slate-700 text-white text-xs rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none text-center" />
                                </>
                              )}
                            </div>
                            {err && <p className="text-[9px] text-red-400 mt-0.5">{err}</p>}
                          </td>
                        )
                      })}
                      <td className={`px-2 py-2 text-center font-semibold whitespace-nowrap ${row.cantTransito > 0 ? 'text-amber-400' : 'text-white'}`}>
                        {row.cantTransito}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {/* Se copia a cada movimiento que registre esta fila al guardar. */}
                        <input value={rowNota[key] ?? ''} onChange={(e) => setRowNota((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder="Nota…"
                          className="w-32 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select value={getRowTecnico(key)}
                          onChange={(e) => {
                            const v = e.target.value
                            setRowTecnico(key, v)
                            // Si el origen de esta fila ya es "de técnico", cambiar
                            // el técnico acá también mueve el origen al nuevo — sin
                            // pasar por setRowBodega, que de paso borraría el lote
                            // tecleado (acá el lote no depende de qué técnico).
                            if (esOrigenTecnico(getRowBodega(row))) {
                              setRowBodegaOverride((prev) => ({ ...prev, [key]: origenTecnicoValue(v) }))
                            }
                          }}
                          className="w-28 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">Técnico…</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{tecnicoLabel(m, row.materialId, getRowLote(row))}</option>)}
                        </select>
                        {errTecnicoFila && <p className="text-[9px] text-red-400 mt-0.5">{errTecnicoFila}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Orden pedido por Andrés: Técnicos (EquipoSection, en LogisticaTab) →
              Material físico (arriba) → Rebaja pendiente → Material digital. */}
          {editableCampos.includes(CAMPO_DIGITAL) && (
            <RebajaPendienteSection
              lineas={lineasRebaja}
              materiales={materiales}
              bodegas={bodegas}
              cellErrors={cellErrors}
              saving={saving}
              sugiriendo={sugiriendo}
              ott={ott}
              direccion={direccion}
              fechaInstalacion={formatFechaExcel(fechaInicio)}
              onSugerir={sugerirRebaja}
              onAgregarManual={agregarLineaRebajaManual}
              onActualizar={actualizarLineaRebaja}
              onQuitar={quitarLineaRebaja}
              onAgregarPaquete={agregarPaqueteRebaja}
            />
          )}

          <TablaDigital
            rows={displayRows}
            rowKey={rowKey}
            ott={ott}
            direccion={direccion}
            fechaInstalacion={formatFechaExcel(fechaInicio)}
          />

          {hayPendientes && (
            <div className="bg-slate-700/40 rounded-xl border border-dashed border-slate-600 p-3 space-y-2">
              <p className="text-[11px] text-slate-400">
                Cada "+" tecleado se registra como su propio movimiento — no se puede restar directamente; para
                corregir un exceso, registra el movimiento contrario (ej. un Devuelto deshace una Entrega).
                {area === 'OyM' && ' En OyM, con origen = bodega, el Instalado descuenta de esa bodega directamente (entrega + instalación en un paso); con origen = técnico, de lo que ese técnico ya tiene.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select value={tecnicoEdicion} onChange={(e) => setTecnicoEdicion(e.target.value)} className={selectCls}>
                  <option value="">Técnico…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
                </select>
                <select value={bodegaEdicion} onChange={(e) => setBodegaEdicion(e.target.value)} className={selectCls}>
                  <option value="">Bodega…</option>
                  {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </select>
                <button type="button" disabled={saving} onClick={guardarCambios}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40">
                  {saving ? 'Guardando…' : `Guardar cambios (${pendientes.length})`}
                </button>
                <button type="button" disabled={saving} onClick={descartarCambios} className="text-xs text-slate-400">
                  Descartar
                </button>
              </div>
            </div>
          )}

        </>
      )}
    </div>
  )
}

// RUT y dirección del contratista (Sinterk) — el control de rebajas de Entel
// exige el mismo valor en toda fila, no depende del proyecto. Ver el Excel
// que compartió Andrés ("CONTROL DE REBAJAS C088.xlsx", pestaña 2026): las
// ~2200 filas existentes usan siempre este mismo par de valores.
const RUT_EMPRESA = '76.512.898-6'
const DIRECCION_EMPRESA = 'Primero de Mayo 3425'

/**
 * `yyyy-mm-dd` (lo que da `fechaInicioDe`, formato de un `<input
 * type="date">`) → `dd.mm.yyyy`, el formato de fecha real que usa el
 * control de rebajas de Entel. No es cosmético: Excel reconoce una fecha
 * como fecha (alineada a la derecha, ordenable, calculable) o la trata como
 * texto suelto según si el string calza con el formato que espera — pegar
 * `2026-01-20` ahí queda como texto plano, "fuera de lugar" entre fechas
 * reales; `20.01.2026` sí lo reconoce.
 */
function formatFechaExcel(iso: string | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

/**
 * Limpia lo que va a un TSV para copiar/pegar: tab y salto de línea rompen
 * el formato de celda-por-celda (mismo problema que ya resolvió `celda()` en
 * EstadoPagoTab.tsx).
 */
function celdaTsv(v: string | number | null | undefined): string {
  return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim()
}

/**
 * Igual que `celdaTsv`, pero fuerza texto plano al pegar en Sheets/Excel —
 * el apóstrofo inicial es la convención que ambos reconocen como "esto es
 * texto, no lo interpretes como número" (no queda visible en la celda
 * pegada). Sin esto, un SKU que se ve numérico pierde ceros a la izquierda o
 * queda como número, y no calza con la columna SKU (texto) del control de
 * rebajas en Drive.
 */
function celdaTextoTsv(v: string | number | null | undefined): string {
  return `'${celdaTsv(v)}`
}

/**
 * Tabla DIGITAL del proyecto (baja contable en SAP). Muestra lo YA
 * rebajado — comparte filas con la física de arriba (mismo SKU y lote de
 * `proyecto_materiales`), así que una fila cargada allá aparece sola acá,
 * sin darla de alta dos veces. Solo lectura — registrar una rebaja nueva
 * vive en `RebajaPendienteSection` más arriba (con sugerencia automática de
 * lote), y corregir un número mal registrado se hace anulando el
 * movimiento real desde Movimientos, no sobreescribiendo el número acá
 * (el "modo corrección" que hacía esto se sacó — pisaba el valor sin
 * mover stock, lo que podía dejarlo mintiendo).
 *
 * Columnas y orden EXACTOS al control de rebajas que Entel espera (mismo
 * Excel de arriba, pestaña 2026, columnas OTT→Cantidad): así seleccionar
 * filas de acá y pegarlas en ese archivo cae directo en su lugar, sin
 * reacomodar nada. `ott`/`direccion`/`fechaInstalacion` son del proyecto
 * completo (mismo valor en cada fila) — los pasa `Editor.tsx` de ATT; en
 * Preventivos/Incidencias, que no los mandan, esas 3 columnas quedan vacías.
 */
function TablaDigital({ rows, rowKey, ott, direccion, fechaInstalacion }: {
  rows: ResumenMaterialProyecto[]
  rowKey: (r: ResumenMaterialProyecto) => string
  ott?: string
  direccion?: string
  fechaInstalacion?: string
}) {
  // Solo lo que de verdad se rebajó — esto es un log de rebajas confirmadas,
  // no el inventario completo del proyecto (ese es la tabla física).
  const filas = rows.filter((r) => r.cantRebajada > 0)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  function copiarTabla() {
    // Sin encabezado: se pega al final de las filas que ya existen en el
    // control de Entel, no reemplaza ni repite ese encabezado. TSV puro
    // (writeText, sin HTML) — así "pegar" y "pegar sin formato" quedan
    // exactamente igual, no hay una versión con estilos que Excel prefiera
    // sobre la otra.
    const texto = filas.map((row) => [
      celdaTsv(ott), celdaTsv(direccion), celdaTsv(fechaInstalacion), celdaTsv(RUT_EMPRESA), celdaTsv(DIRECCION_EMPRESA),
      celdaTextoTsv(row.materialSku), celdaTsv(row.materialDescripcion), celdaTsv(row.lote), row.cantRebajada,
    ].join('\t')).join('\n')
    navigator.clipboard.writeText(texto)
      .then(() => setCopyMsg(`${filas.length} fila(s) copiada(s) — pega al final del control de rebajas.`))
      .catch(() => setCopyMsg('No se pudo copiar al portapapeles.'))
  }

  if (filas.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Material digital (SAP)</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Baja contable en SAP, sin movimiento físico. Formato listo para copiar y pegar en el control de rebajas de Entel.
          </p>
        </div>
        <button type="button" onClick={copiarTabla}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white shrink-0">
          📋 Copiar tabla
        </button>
      </div>
      {copyMsg && <p className="text-[11px] text-green-400">{copyMsg}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
              <th className="px-2 py-2 font-medium whitespace-nowrap">OTT</th>
              <th className="px-2 py-2 font-medium">Dirección de trabajos</th>
              <th className="px-2 py-2 font-medium whitespace-nowrap">Fecha de instalación</th>
              <th className="px-2 py-2 font-medium whitespace-nowrap">RUT empresa</th>
              <th className="px-2 py-2 font-medium">Dirección empresa</th>
              <th className="px-2 py-2 font-medium whitespace-nowrap">SKU</th>
              <th className="px-2 py-2 font-medium">Material</th>
              <th className="px-2 py-2 font-medium whitespace-nowrap">Lote</th>
              <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((row) => {
              const key = rowKey(row)
              return (
                <tr key={key} className="border-t border-slate-700 divide-x divide-slate-700 bg-slate-800/60">
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{ott || '—'}</td>
                  <td className="px-2 py-2 max-w-[220px]"><p className="text-slate-300 truncate">{direccion || '—'}</p></td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{fechaInstalacion || '—'}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{RUT_EMPRESA}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{DIRECCION_EMPRESA}</td>
                  <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{row.materialSku}</td>
                  <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{row.materialDescripcion}</p></td>
                  <td className="px-2 py-2 text-slate-400 whitespace-nowrap">{row.lote || '—'}</td>
                  <td className="px-2 py-2 text-center whitespace-nowrap align-top">
                    <span className="text-white font-medium">{row.cantRebajada}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Rebaja PENDIENTE — registrar nueva baja SAP, separado de `TablaDigital`
 * (que solo muestra/corrige lo ya rebajado). "↻ Sugerir rebaja" calcula
 * cuánto falta por material (Instalado − ya rebajado) y arma las líneas con
 * el algoritmo de reparto de `sugerirRebaja` en el padre — acá solo se
 * renderizan y se editan. Nada se guarda hasta "Guardar cambios" (mismo
 * botón/mecanismo que el resto de la tabla, ver `guardarCambios`).
 */
function RebajaPendienteSection({
  lineas, materiales, bodegas, cellErrors, saving, sugiriendo,
  ott, direccion, fechaInstalacion,
  onSugerir, onAgregarManual, onActualizar, onQuitar, onAgregarPaquete,
}: {
  lineas: LineaRebaja[]
  materiales: Material[]
  bodegas: Ubicacion[]
  cellErrors: Record<string, string>
  saving: boolean
  sugiriendo: boolean
  ott?: string
  direccion?: string
  fechaInstalacion?: string
  onSugerir: () => Promise<void>
  onAgregarManual: () => void
  onActualizar: (localId: string, patch: Partial<LineaRebaja>) => void
  onQuitar: (localId: string) => void
  onAgregarPaquete: (localId: string, materialIds: string[]) => void
}) {
  const selectCls = 'bg-slate-700 text-white text-xs rounded-lg px-2 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none'
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  function copiarTabla() {
    // Solo líneas con material y cantidad puestos — una fila manual a medio
    // llenar no sirve para pegar en ningún lado. Mismo TSV puro que
    // TablaDigital, sin encabezado (se pega al final de las filas que ya
    // existen en el control de Entel).
    const listas = lineas.filter((l) => l.materialId && Number(l.cantidad) > 0)
    const texto = listas.map((l) => [
      celdaTsv(ott), celdaTsv(direccion), celdaTsv(fechaInstalacion), celdaTsv(RUT_EMPRESA), celdaTsv(DIRECCION_EMPRESA),
      celdaTextoTsv(l.materialSku), celdaTsv(l.materialDescripcion), celdaTsv(l.lote), l.cantidad,
    ].join('\t')).join('\n')
    navigator.clipboard.writeText(texto)
      .then(() => setCopyMsg(`${listas.length} fila(s) copiada(s) — pega al final del control de rebajas.`))
      .catch(() => setCopyMsg('No se pudo copiar al portapapeles.'))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Rebaja pendiente</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            Registra nueva baja SAP. "Sugerir" propone lote y cantidad a partir de lo instalado, priorizando la bodega del área — revisa y ajusta antes de guardar. Formato listo para copiar y pegar en el control de rebajas de Entel, igual que "Material digital". Cable nunca se reparte entre lotes: usa el mismo lote físico si ya se conoce, o uno solo que alcance completo.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lineas.length > 0 && (
            <button type="button" onClick={copiarTabla}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white">
              📋 Copiar tabla
            </button>
          )}
          <button type="button" disabled={sugiriendo || saving} onClick={onSugerir}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white">
            {sugiriendo ? 'Calculando…' : '↻ Sugerir rebaja'}
          </button>
        </div>
      </div>
      {copyMsg && <p className="text-[11px] text-green-400">{copyMsg}</p>}

      {lineas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/60 text-slate-400 text-left divide-x divide-slate-700">
                {/* Mismas 9 columnas y orden que "Material digital" (y que el
                    control de rebajas de Entel) — así al confirmar la
                    sugerencia se puede copiar igual, antes incluso de guardar.
                    Bodega/Origen/Acción van después, son de uso interno. */}
                <th className="px-2 py-2 font-medium whitespace-nowrap">OTT</th>
                <th className="px-2 py-2 font-medium">Dirección de trabajos</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">Fecha de instalación</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">RUT empresa</th>
                <th className="px-2 py-2 font-medium">Dirección empresa</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">SKU</th>
                <th className="px-2 py-2 font-medium">Material</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">Lote</th>
                <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Cantidad</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">Bodega</th>
                <th className="px-2 py-2 font-medium whitespace-nowrap">Origen</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const errMaterial = cellErrors[`${l.localId}|__material__`]
                const errBodega = cellErrors[`${l.localId}|__bodega__`]
                const errCantidad = cellErrors[`${l.localId}|__cantidad__`]
                const sinLote = l.origen === 'auto' && !l.lote
                return (
                  <tr key={l.localId} className={`border-t border-slate-700 divide-x divide-slate-700 ${sinLote ? 'bg-amber-950/30' : 'bg-slate-800/60'}`}>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{ott || '—'}</td>
                    <td className="px-2 py-2 max-w-[220px]"><p className="text-slate-300 truncate">{direccion || '—'}</p></td>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{fechaInstalacion || '—'}</td>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{RUT_EMPRESA}</td>
                    <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{DIRECCION_EMPRESA}</td>
                    <td className="px-2 py-2 align-top">
                      {l.materialId ? (
                        <span className="text-slate-300 whitespace-nowrap">{l.materialSku}</span>
                      ) : (
                        <MaterialSelect materiales={materiales} value={l.materialId}
                          onChange={(id) => {
                            const m = materiales.find((mm) => mm.id === id)
                            onActualizar(l.localId, { materialId: id, materialSku: m?.sku ?? '', materialDescripcion: m?.descripcion ?? '', lote: '' })
                          }}
                          onSelectPaquete={(materialIds) => onAgregarPaquete(l.localId, materialIds)}
                          className="w-36" />
                      )}
                      {errMaterial && <p className="text-[9px] text-red-400 mt-0.5">{errMaterial}</p>}
                    </td>
                    <td className="px-2 py-2 max-w-[220px]"><p className="text-white truncate">{l.materialDescripcion}</p></td>
                    <td className="px-2 py-2 align-top">
                      <LoteSelect materialId={l.materialId} ubicacionId={l.ubicacionBodegaId || null} naturaleza="digital"
                        checkAvailability={false} value={l.lote}
                        onChange={(lote) => onActualizar(l.localId, { lote })}
                        className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                      {sinLote && (
                        <p className="text-[9px] text-amber-400 mt-0.5">
                          Sin stock digital suficiente en {bodegas.find((b) => b.id === l.ubicacionBodegaId)?.nombre ?? 'esa bodega'}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center align-top">
                      <input type="number" min="0" step="any" value={l.cantidad}
                        onChange={(e) => onActualizar(l.localId, { cantidad: e.target.value })}
                        className="w-16 bg-slate-700 text-white text-xs rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none text-center" />
                      {errCantidad && <p className="text-[9px] text-red-400 mt-0.5">{errCantidad}</p>}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <select value={l.ubicacionBodegaId} onChange={(e) => onActualizar(l.localId, { ubicacionBodegaId: e.target.value, lote: '' })}
                        className={selectCls}>
                        <option value="">Bodega…</option>
                        {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                      </select>
                      {errBodega && <p className="text-[9px] text-red-400 mt-0.5">{errBodega}</p>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap align-top">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${l.origen === 'auto' ? 'bg-blue-900/50 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>
                        {l.origen === 'auto' ? 'Auto' : 'Manual'}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <button type="button" onClick={() => onQuitar(l.localId)} className="text-[10px] text-slate-500 hover:text-red-400">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <button type="button" onClick={onAgregarManual}
        className="text-[10px] font-semibold px-2 py-1 rounded-lg text-brand-400 hover:bg-slate-700">
        + Agregar línea de rebaja
      </button>
    </div>
  )
}
