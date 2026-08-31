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
import { BODEGA_DEFECTO_POR_AREA } from '@/lib/inventario/defaults'
import { esTipoCable } from '@/lib/inventario/esCable'
import { esTipoFerreteria, LOTE_FISICO_FERRETERIA } from '@/lib/inventario/esFerreteria'
import {
  corregirProyectoMaterial, getResumenProyecto, getStock, listMateriales, listUbicaciones,
  reasignarTransitoAPreventivo, registrarMovimiento,
} from '@/lib/inventario/inventarioRepo'
import type { CampoCorregible } from '@/lib/inventario/inventarioRepo'
import type { Material, MovimientoTipoUI, ResumenMaterialProyecto, Ubicacion } from '@/lib/inventario/types'
import { LoteSelect } from './LoteSelect'
import { MaterialSelect } from './MaterialSelect'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  area: 'ATT' | 'OyM'
  /** Solo se pasa para Preventivos: habilita el desglose "· <nombre del punto>" por fila. */
  puntos?: Punto[]
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
/** Campos corregibles directo (viven como columna propia en proyecto_materiales). Solicitado queda afuera: es un cálculo (suma de movimientos tipo='solicitud'), no una columna. */
const CAMPO_DB: Partial<Record<Campo, CampoCorregible>> = {
  cantEntregada: 'cant_entregada', cantInstalada: 'cant_instalada',
  cantDevuelta: 'cant_devuelta', cantRebajada: 'cant_rebajada', cantMerma: 'cant_merma',
  cantRezagada: 'cant_rezagada',
}
/**
 * El material del proyecto se muestra en DOS tablas (pedido de Andrés):
 * la física (lo que se mueve de verdad) y la digital (la baja contable en
 * SAP). `cantRebajada` es la única columna digital — por eso sale de la
 * tabla física y vive en `TablaDigital`, más abajo. Ambas comparten el
 * mismo estado (`edits`/`corrections`) y las mismas filas de
 * `proyecto_materiales`: por eso una fila nueva cargada en la física
 * aparece sola en la digital, con el mismo SKU y lote.
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
  for (const r of rows) {
    const k = `${r.materialId}|${r.lote}`
    let acc = map.get(k)
    if (!acc) {
      acc = {
        materialId: r.materialId, materialSku: r.materialSku, materialDescripcion: r.materialDescripcion,
        lote: r.lote, puntoId: null,
        cantSolicitada: 0, cantEntregada: 0, cantInstalada: 0, cantDevuelta: 0, cantRezagada: 0, cantRebajada: 0,
        cantMerma: 0, cantTransito: 0,
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

export function ResumenProyectoTable({ projectId, area, puntos, refreshKey = 0, membersVersion = 0, ott, direccion, fechaInicio }: Props) {
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
  const mostrandoTodosLosPuntos = !!puntos && puntoFiltro === TODOS_LOS_PUNTOS
  const [rows, setRows] = useState<ResumenMaterialProyecto[] | null>(null)
  // Lo que la tabla realmente muestra/edita — agregado por defecto en
  // Preventivos, filtrado a un punto si se eligió uno; sin `puntos` (ATT/
  // Incidencias) es igual a `rows`. guardarCambios/guardarCorrecciones deben
  // iterar ESTO, no `rows` crudo, porque una fila agregada (puntoId null)
  // puede no existir tal cual en `rows` si todo lo entregado ya tiene punto.
  const displayRows = rows === null ? [] : (
    mostrandoTodosLosPuntos ? agregarPorMaterial(rows)
      : puntos ? rows.filter((r) => r.puntoId === puntoFiltro)
      : rows
  )
  const editableCamposVista: Campo[] = mostrandoTodosLosPuntos ? editableCampos.filter((c) => c !== 'cantInstalada') : editableCampos
  const [materiales, setMateriales] = useState<Material[]>([])
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [bodegas, setBodegas] = useState<Ubicacion[]>([])
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

  // Modo corrección: sobreescribe el valor absoluto sin generar movimiento
  // ni tocar stock — solo para arreglar un error de tipeo. `corrections`
  // guarda el valor tecleado (no el delta); se compara contra el valor
  // actual de la fila al guardar para saltar las celdas sin cambios.
  const [modoCorreccion, setModoCorreccion] = useState(false)
  const [corrections, setCorrections] = useState<Record<string, Partial<Record<Campo, string>>>>({})
  const [correctionErrors, setCorrectionErrors] = useState<Record<string, string>>({})
  const [correcting, setCorrecting] = useState(false)

  async function reload() {
    try { setRows(await getResumenProyecto(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { setRows(null); reload() }, [projectId, refreshKey])
  useEffect(() => { adminRepo.listMembers(projectId).then(setMembers).catch(() => {}) }, [projectId, membersVersion])
  useEffect(() => { listUbicaciones({ tipo: 'bodega' }).then(setBodegas).catch(() => {}) }, [])
  useEffect(() => { listMateriales().then(setMateriales).catch(() => {}) }, [])

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
  function getRowBodega(key: string): string {
    return rowBodegaOverride[key] || bodegaEdicion
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
    setNuevasFilas((prev) => [...prev, filaVacia(members[0]?.id ?? '', defaultBodegaId)])
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

  /**
   * Recalcula las líneas `origen:'auto'` de rebaja pendiente, preservando
   * las `manual` que ya se hayan agregado (mismo patrón que "Regenerar
   * avance" del Estado de Pago: botón, no automático).
   *
   * CABLE es un caso aparte (pedido explícito de Andrés) — nunca se reparte
   * entre varios lotes:
   *   - Si el físico YA tiene un lote real (no 'SinDefinir'), la rebaja va
   *     contra ESE MISMO lote, siempre, sin buscar ni comparar disponible —
   *     es de ahí de donde salió de verdad. El digital ya permite negativo
   *     (0055), así que no hace falta que "alcance" para usarlo.
   *   - Si el físico todavía no tiene lote, se busca UN lote digital que
   *     cubra toda la cantidad — nunca varios. Si ninguno alcanza solo,
   *     queda una línea sin lote con el total, para completar a mano.
   * Cable tampoco se agrupa por material entre lotes distintos: cada fila
   * física (material+lote) es su propia línea de rebaja.
   *
   * Todo lo demás sigue igual que antes: se agrupa por material (sin
   * importar el lote físico) y se reparte entre TODOS los lotes digitales
   * disponibles, en cualquier bodega, priorizando la del área (C088 en ATT,
   * C132 en OyM — `defaultBodegaId`) de MENOR a MAYOR cantidad; agotada esa
   * bodega, sigue con el resto también de menor a mayor. Si ni sumando todo
   * alcanza, la línea final queda con el faltante y sin lote.
   */
  async function sugerirRebaja() {
    setError(null)
    setSugiriendo(true)
    try {
      const auto: LineaRebaja[] = []
      const filasCable: typeof displayRows = []
      const filasResto: typeof displayRows = []
      for (const row of displayRows) {
        const tipoNombre = materiales.find((m) => m.id === row.materialId)?.tipo?.nombre
        ;(esTipoCable(tipoNombre) ? filasCable : filasResto).push(row)
      }

      for (const row of filasCable) {
        const necesario = Math.round((row.cantInstalada - row.cantRebajada) * 100) / 100
        if (necesario <= 0) continue

        if (row.lote && row.lote !== 'SinDefinir') {
          const stockLote = await getStock({ materialId: row.materialId, lote: row.lote })
          const ubicacion = stockLote.find((s) => s.ubicacionId === defaultBodegaId) ?? stockLote[0]
          auto.push({
            localId: nanoid(8), materialId: row.materialId, materialSku: row.materialSku, materialDescripcion: row.materialDescripcion,
            lote: row.lote, ubicacionBodegaId: ubicacion?.ubicacionId ?? defaultBodegaId, cantidad: String(necesario), origen: 'auto',
          })
          continue
        }

        // Sin lote físico todavía: un solo lote digital que cubra todo,
        // nunca varios. Entre los que alcanzan, prioriza la bodega del
        // área y, dentro de esa prioridad, el más ajustado (menor sobrante).
        const stockMaterial = await getStock({ materialId: row.materialId })
        const candidato = stockMaterial
          .filter((s) => s.cantidadDigital >= necesario)
          .sort((a, b) => {
            const prioridadA = a.ubicacionId === defaultBodegaId
            const prioridadB = b.ubicacionId === defaultBodegaId
            return prioridadA !== prioridadB ? (prioridadA ? -1 : 1) : a.cantidadDigital - b.cantidadDigital
          })[0]
        auto.push({
          localId: nanoid(8), materialId: row.materialId, materialSku: row.materialSku, materialDescripcion: row.materialDescripcion,
          lote: candidato?.lote ?? '', ubicacionBodegaId: candidato?.ubicacionId ?? defaultBodegaId,
          cantidad: String(necesario), origen: 'auto',
        })
      }

      const necesarioPorMaterial = new Map<string, { sku: string; descripcion: string; necesario: number }>()
      for (const row of filasResto) {
        const acc = necesarioPorMaterial.get(row.materialId) ?? { sku: row.materialSku, descripcion: row.materialDescripcion, necesario: 0 }
        acc.necesario += row.cantInstalada - row.cantRebajada
        necesarioPorMaterial.set(row.materialId, acc)
      }
      for (const [materialId, info] of necesarioPorMaterial) {
        let restante = Math.round(info.necesario * 100) / 100
        if (restante <= 0) continue

        const stockMaterial = await getStock({ materialId })
        const lotes = stockMaterial
          .filter((s) => s.cantidadDigital > 0)
          .map((s) => ({ ubicacionId: s.ubicacionId, lote: s.lote, disponible: s.cantidadDigital, prioridad: s.ubicacionId === defaultBodegaId }))
          .sort((a, b) => (a.prioridad !== b.prioridad ? (a.prioridad ? -1 : 1) : a.disponible - b.disponible))

        for (const l of lotes) {
          if (restante <= 0) break
          const usar = Math.min(l.disponible, restante)
          auto.push({
            localId: nanoid(8), materialId, materialSku: info.sku, materialDescripcion: info.descripcion,
            lote: l.lote, ubicacionBodegaId: l.ubicacionId, cantidad: String(usar), origen: 'auto',
          })
          restante -= usar
        }
        if (restante > 0) {
          // Sin lote que cubra el resto en NINGUNA bodega — se deja
          // explícito, en vez de inventar uno, para completar a mano.
          auto.push({
            localId: nanoid(8), materialId, materialSku: info.sku, materialDescripcion: info.descripcion,
            lote: '', ubicacionBodegaId: defaultBodegaId, cantidad: String(restante), origen: 'auto',
          })
        }
      }
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
        const bodegaFila = getRowBodega(key)
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
            await registrarMovimiento({
              tipoUI: CAMPO_TIPO[campo]!, materialId: row.materialId, cantidad: n, lote: loteFila || undefined,
              projectId, puntoId: row.puntoId, tecnicoUserId: tecnicoFila,
              ubicacionBodegaId: CAMPO_NECESITA_BODEGA.includes(campo) ? bodegaFila : undefined,
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
        if (CAMPO_NECESITA_BODEGA.includes(campo) && !fila.ubicacionBodegaId) {
          nextErrors[`${fila.localId}|${campo}`] = 'Falta elegir bodega'
          nextFilaEdits[campo] = raw
          continue
        }
        try {
          await registrarMovimiento({
            tipoUI: CAMPO_TIPO[campo]!, materialId: fila.materialId, cantidad: n, lote: fila.lote || undefined,
            projectId, puntoId: fila.puntoId, tecnicoUserId: fila.tecnicoUserId,
            ubicacionBodegaId: CAMPO_NECESITA_BODEGA.includes(campo) ? fila.ubicacionBodegaId : undefined,
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

  function setCorrection(key: string, campo: Campo, v: string) {
    setCorrections((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: v } }))
  }

  const correccionesPendientes = displayRows.flatMap((row) => {
    const key = rowKey(row)
    const byCampo = corrections[key]
    if (!byCampo) return []
    return (Object.keys(byCampo) as Campo[])
      .filter((campo) => byCampo[campo] !== undefined && byCampo[campo] !== '' && Number(byCampo[campo]) !== row[campo])
  })
  const hayCorreccionesPendientes = correccionesPendientes.length > 0

  async function guardarCorrecciones() {
    if (!rows) return
    setCorrecting(true)
    setError(null)
    const nextCorrections: typeof corrections = {}
    const nextErrors: Record<string, string> = {}
    for (const row of displayRows) {
      const key = rowKey(row)
      const byCampo = corrections[key]
      if (!byCampo) continue
      for (const campo of Object.keys(byCampo) as Campo[]) {
        const raw = byCampo[campo]
        const dbCampo = CAMPO_DB[campo]
        if (raw === undefined || raw === '' || !dbCampo) continue
        const n = Number(raw)
        if (n === row[campo]) continue // sin cambio real, no molestar con una llamada de más
        if (!(n >= 0)) {
          nextErrors[`${key}|${campo}`] = 'Cantidad inválida'
          nextCorrections[key] = { ...nextCorrections[key], [campo]: raw }
          continue
        }
        try {
          await corregirProyectoMaterial({
            projectId, materialId: row.materialId, lote: row.lote, puntoId: row.puntoId, campo: dbCampo, valor: n,
          })
        } catch (err) {
          nextErrors[`${key}|${campo}`] = err instanceof Error ? err.message : String(err)
          nextCorrections[key] = { ...nextCorrections[key], [campo]: raw }
        }
      }
    }
    setCorrections(nextCorrections)
    setCorrectionErrors(nextErrors)
    setCorrecting(false)
    await reload()
  }

  function descartarCorrecciones() {
    setCorrections({})
    setCorrectionErrors({})
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
              onChange={(e) => {
                setPuntoFiltro(e.target.value)
                if (e.target.value === TODOS_LOS_PUNTOS) { setModoCorreccion(false); descartarCorrecciones() }
              }}
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
          {puedeCorregir && rows && rows.length > 0 && !mostrandoTodosLosPuntos && (
            <button type="button"
              onClick={() => { setModoCorreccion((v) => !v); descartarCorrecciones() }}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${modoCorreccion ? 'bg-amber-600 text-white' : 'text-amber-400 hover:bg-slate-700'}`}>
              🔧 {modoCorreccion ? 'Salir de corrección' : 'Corregir errores de tipeo'}
            </button>
          )}
        </div>
      </div>
      {modoCorreccion && (
        <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg p-2">
          Esto sobreescribe el número directo, sin registrar un movimiento ni tocar el stock físico/digital de la
          bodega. Úsalo solo para arreglar un error de tipeo (ej. escribiste 15 en vez de 5) — si el número está mal
          porque realmente se entregó/instaló/devolvió/rebajó una cantidad distinta, no lo corrijas acá: usa el "+"
          normal, así queda el movimiento real registrado. <strong>Solicitado</strong> no se puede corregir así,
          porque no es un valor propio — se calcula sumando los movimientos de Solicitud.
        </p>
      )}
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
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Bodega</th>
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
                          className="w-36" />
                        {errMaterial && <p className="text-[9px] text-red-400 mt-0.5">{errMaterial}</p>}
                      </td>
                      <td className="px-2 py-2 align-top space-y-1">
                        <select value={fila.ubicacionBodegaId}
                          onChange={(e) => actualizarFilaNueva(fila.localId, { ubicacionBodegaId: e.target.value, lote: esFerreteriaFila ? LOTE_FISICO_FERRETERIA : '' })}
                          className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">Bodega…</option>
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
                          <LoteSelect materialId={fila.materialId} ubicacionId={fila.ubicacionBodegaId || null} naturaleza="fisico"
                            checkAvailability={false} value={fila.lote}
                            onChange={(lote) => actualizarFilaNueva(fila.localId, { lote })}
                            className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                        )}
                      </td>
                      {CAMPOS_FISICOS.map((campo) => {
                        // "Asignado a técnico" no aplica a una fila nueva: no hay
                        // nada entregado todavía que se pueda reasignar.
                        if (campo === CAMPO_REASIGNACION || !editableCampos.includes(campo)) {
                          return <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top text-slate-600">—</td>
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
                          onChange={(e) => actualizarFilaNueva(fila.localId, { tecnicoUserId: e.target.value })}
                          className="w-28 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">Técnico…</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
                        </select>
                        {errTecnico && <p className="text-[9px] text-red-400 mt-0.5">{errTecnico}</p>}
                      </td>
                    </tr>
                  )
                })}
                {displayRows.map((row) => {
                  const key = rowKey(row)
                  const draft = edits[key] ?? {}
                  const correctionDraft = corrections[key] ?? {}
                  const errTecnicoFila = cellErrors[`${key}|__tecnico__`]
                  const esFerreteriaFila = esTipoFerreteria(materiales.find((m) => m.id === row.materialId)?.tipo?.nombre)
                  return (
                    <tr key={key} className="shadow-[inset_0_1px_0_0_#334155] divide-x divide-slate-700 bg-slate-800/60">
                      <td className="px-2 py-2 w-20 max-w-[5rem] sticky left-0 z-10 bg-slate-800 isolate">
                        <p className="text-white truncate w-20" title={row.materialDescripcion}>{row.materialDescripcion}</p>
                      </td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{row.materialSku}</td>
                      <td className="px-2 py-2 align-top">
                        <select value={getRowBodega(key)} onChange={(e) => setRowBodega(key, e.target.value)}
                          className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">Bodega…</option>
                          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top space-y-1">
                        {esFerreteriaFila ? (
                          <span className="text-slate-400 text-xs">Físico</span>
                        ) : (
                          <LoteSelect materialId={row.materialId} ubicacionId={getRowBodega(key) || null} naturaleza="fisico"
                            checkAvailability={false} value={getRowLote(row)}
                            onChange={(lote) => setRowLote(key, lote)}
                            className="w-24 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none" />
                        )}
                      </td>
                      {CAMPOS_FISICOS.map((campo) => {
                        const valor = row[campo]
                        const esCorregible = modoCorreccion && CAMPO_DB[campo] !== undefined && editableCamposVista.includes(campo)
                        if (esCorregible) {
                          const err = correctionErrors[`${key}|${campo}`]
                          return (
                            <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-slate-500 text-[10px]">=</span>
                                <input type="number" min="0" step="any" value={correctionDraft[campo] ?? String(valor)}
                                  onChange={(e) => setCorrection(key, campo, e.target.value)}
                                  className="w-12 bg-amber-950/30 text-amber-200 text-xs rounded px-1 py-0.5 border border-amber-700/60 focus:border-amber-500 focus:outline-none text-center" />
                              </div>
                              {err && <p className="text-[9px] text-red-400 mt-0.5">{err}</p>}
                            </td>
                          )
                        }
                        if (!editableCamposVista.includes(campo)) {
                          return (
                            <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                              <span className="text-white font-medium">{valor}</span>
                            </td>
                          )
                        }
                        const err = cellErrors[`${key}|${campo}`]
                        return (
                          <td key={campo} className="px-2 py-2 text-center whitespace-nowrap align-top">
                            <div className="flex items-center justify-center gap-1">
                              <span className="text-white font-medium">{valor}</span>
                              <span className="text-slate-500 text-[10px]">+</span>
                              <input type="number" min="0" step="any" placeholder="0" value={draft[campo] ?? ''}
                                onChange={(e) => setDraft(key, campo, e.target.value)}
                                className="w-12 bg-slate-700 text-white text-xs rounded px-1 py-0.5 border border-slate-600 focus:border-brand-500 focus:outline-none text-center" />
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
                        <select value={getRowTecnico(key)} onChange={(e) => setRowTecnico(key, e.target.value)}
                          className="w-28 bg-slate-700 text-white text-xs rounded px-1.5 py-1 border border-slate-600 focus:border-brand-500 focus:outline-none">
                          <option value="">Técnico…</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
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
            />
          )}

          <TablaDigital
            rows={displayRows}
            rowKey={rowKey}
            ott={ott}
            direccion={direccion}
            fechaInstalacion={formatFechaExcel(fechaInicio)}
            modoCorreccion={modoCorreccion}
            corrections={corrections}
            onCorrection={setCorrection}
            correctionErrors={correctionErrors}
            editable={editableCampos.includes(CAMPO_DIGITAL)}
          />

          {hayPendientes && (
            <div className="bg-slate-700/40 rounded-xl border border-dashed border-slate-600 p-3 space-y-2">
              <p className="text-[11px] text-slate-400">
                Cada "+" tecleado se registra como su propio movimiento — no se puede restar directamente; para
                corregir un exceso, registra el movimiento contrario (ej. un Devuelto deshace una Entrega).
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

          {hayCorreccionesPendientes && (
            <div className="bg-amber-950/30 rounded-xl border border-dashed border-amber-800/60 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={correcting} onClick={guardarCorrecciones}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40">
                  {correcting ? 'Guardando…' : `Guardar corrección (${correccionesPendientes.length})`}
                </button>
                <button type="button" disabled={correcting} onClick={descartarCorrecciones} className="text-xs text-slate-400">
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
 * Tabla DIGITAL del proyecto (baja contable en SAP). Muestra lo YA
 * rebajado — comparte filas con la física de arriba (mismo SKU y lote de
 * `proyecto_materiales`), así que una fila cargada allá aparece sola acá,
 * sin darla de alta dos veces. Solo lectura salvo en modo corrección (ajusta
 * el número sin mover stock, para arreglar un error de tipeo — igual que el
 * resto de columnas corregibles).
 *
 * Registrar NUEVA rebaja ya no se hace en esta tabla — vive en
 * `RebajaPendienteSection`, arriba, con sugerencia automática de lote.
 *
 * Columnas y orden EXACTOS al control de rebajas que Entel espera (mismo
 * Excel de arriba, pestaña 2026, columnas OTT→Cantidad): así seleccionar
 * filas de acá y pegarlas en ese archivo cae directo en su lugar, sin
 * reacomodar nada. `ott`/`direccion`/`fechaInstalacion` son del proyecto
 * completo (mismo valor en cada fila) — los pasa `Editor.tsx` de ATT; en
 * Preventivos/Incidencias, que no los mandan, esas 3 columnas quedan vacías.
 */
function TablaDigital({
  rows, rowKey, ott, direccion, fechaInstalacion,
  modoCorreccion, corrections, onCorrection, correctionErrors, editable,
}: {
  rows: ResumenMaterialProyecto[]
  rowKey: (r: ResumenMaterialProyecto) => string
  ott?: string
  direccion?: string
  fechaInstalacion?: string
  modoCorreccion: boolean
  corrections: Record<string, Partial<Record<Campo, string>>>
  onCorrection: (key: string, campo: Campo, v: string) => void
  correctionErrors: Record<string, string>
  editable: boolean
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
      celdaTsv(row.materialSku), celdaTsv(row.materialDescripcion), celdaTsv(row.lote), row.cantRebajada,
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
              const errCorreccion = correctionErrors[`${key}|${CAMPO_DIGITAL}`]
              const esCorregible = modoCorreccion && editable
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
                    {esCorregible ? (
                      <>
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-slate-500 text-[10px]">=</span>
                          <input type="number" min="0" step="any"
                            value={corrections[key]?.[CAMPO_DIGITAL] ?? String(row.cantRebajada)}
                            onChange={(e) => onCorrection(key, CAMPO_DIGITAL, e.target.value)}
                            className="w-12 bg-amber-950/30 text-amber-200 text-xs rounded px-1 py-0.5 border border-amber-700/60 focus:border-amber-500 focus:outline-none text-center" />
                        </div>
                        {errCorreccion && <p className="text-[9px] text-red-400 mt-0.5">{errCorreccion}</p>}
                      </>
                    ) : (
                      <span className="text-white font-medium">{row.cantRebajada}</span>
                    )}
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
  onSugerir, onAgregarManual, onActualizar, onQuitar,
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
      celdaTsv(l.materialSku), celdaTsv(l.materialDescripcion), celdaTsv(l.lote), l.cantidad,
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
                      {sinLote && <p className="text-[9px] text-amber-400 mt-0.5">Sin lote con stock suficiente</p>}
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
