// Capa de datos ATT: mapea AttRecord ↔ projects + informes + tramos/hitos/fotos
// contra Supabase. 1 OTT = 1 project = 1 informe (relación 1:1).
//
// Convención de id: `AttRecord.id` es el uuid de `projects`. Los hijos cuelgan
// del `informe`, que se resuelve por `project_id` (1:1). El versionado por copia
// y el cierre son features aparte; aquí solo se mapea el contenido del informe.
//
// Fotos: el binario vive en Storage (bucket `fotos`, paso 2). Este repo solo
// persiste filas de `fotos` que ya tengan `storagePath`; la subida del blob y la
// resolución de signed URLs se hacen en la capa de fotos. `previewUrl` se deja
// vacío al leer (se rellena luego con la signed URL).

import { supabase } from '@/lib/supabaseClient'
import { removeProject, closeProject, reopenProject } from '@/lib/projectLifecycle'
import { emptyAttRecord } from '../store'
import type {
  AttRecord, FotoEntry, TramoCable, Hito, TipoProyecto,
} from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ¿el id ya es un uuid de Postgres (registro existente) o un id de cliente? */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

/** timestamptz de Postgres → epoch ms (para createdAt/updatedAt del store). */
function toMs(ts: string | null | undefined): number {
  return ts ? Date.parse(ts) : Date.now()
}

/** '' → null para columnas date/timestamptz (Postgres rechaza '' en date). */
function orNull(v: string | undefined | null): string | null {
  return v && v.trim() !== '' ? v : null
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/**
 * Inserta un `projects` nuevo de forma segura de reintentar. El primer
 * guardado de un borrador local (id = nanoid) no tenía ninguna clave
 * estable — si la conexión se cortaba justo después de que el insert ya se
 * aplicó en el servidor pero antes de que el cliente viera la respuesta
 * (típico al quedar offline a mitad de un guardado), el reintento repetía
 * el mismo insert y creaba una fila duplicada (mismo bug reportado por
 * Andrés en Preventivos — esta parte del código es idéntica ahí).
 * `clientLocalId` (el nanoid de creación) se manda como columna; antes de
 * insertar se busca si ya existe una fila con ese valor — si sí, es un
 * reintento tras respuesta perdida y se usa esa fila en vez de insertar otra.
 */
async function insertProjectIdempotente(clientLocalId: string, patch: Record<string, unknown>): Promise<string> {
  const { data: existente, error: errBuscar } = await supabase
    .from('projects').select('id').eq('client_local_id', clientLocalId).maybeSingle()
  if (errBuscar) throw new Error(`projects.buscarPorClientLocalId: ${errBuscar.message}`)
  if (existente) return existente.id

  const userId = await currentUserId()
  const { data, error } = await supabase
    .from('projects')
    .insert({ ...patch, created_by: userId, client_local_id: clientLocalId })
    .select('id')
    .single()
  if (!error) return data.id

  if (error.code === '23505') {
    // Un 23505 acá puede ser CUALQUIERA de dos constraints distintas de
    // `projects`: el reintento por `client_local_id` (0046, el caso para el
    // que se escribió esta recuperación) o `unique(ott, version)` (0001) —
    // un OTT que ya existe. Antes se asumía siempre la primera; si el
    // conflicto real era el OTT duplicado, la búsqueda por client_local_id
    // no encontraba nada y reventaba con un error de "no rows" que no
    // decía la causa real (ver 0063_ott_unico_solo_att.sql, que además saca
    // esta constraint para Preventivos/Incidencias, donde reusar el nombre
    // entre períodos es normal — en ATT sí es una colisión real).
    const { data: existente2 } = await supabase
      .from('projects').select('id').eq('client_local_id', clientLocalId).maybeSingle()
    if (existente2) return existente2.id
    throw new Error(`projects.insert: ya existe un proyecto con el OTT "${String(patch.ott ?? '')}"`)
  }
  throw new Error(`projects.insert: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Formas de fila (parcial; solo lo que tocamos)
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string
  ott: string | null
  tipo_proyecto: string | null
  nombre_proyecto: string | null
  iniciativa: string | null
  codigo_servicio: string | null
  nombre_servicio: string | null
  comuna: string | null
  direccion: string | null
  region: string | null
  contratista: string | null
  ingeniero_proyecto: string | null
  jefe_proyecto: string | null
  coords_inicio: { lat: string; lng: string } | null
  coords_termino: { lat: string; lng: string } | null
  estado: 'activo' | 'cerrado'
  fecha_cierre: string | null
  fecha_inicio: string | null
  created_at: string
  updated_at: string
  informes?: InformeRow[]
}

interface InformeRow {
  id: string
  project_id: string
  titulo_informe: string | null
  fecha: string | null
  descripcion_cabecera: string | null
  instala_cmic: boolean
  instala_mufas: boolean
  tiene_reparacion_ducto: boolean
  tiene_ingreso_red: boolean
  ingreso_red: AttRecord['ingresoRed'] | null
  infraestructura: AttRecord['infraestructura'] | null
  foto_general_path: string | null
  tramos?: TramoRow[]
  hitos?: HitoRow[]
  fotos?: FotoRow[]
}

interface TramoRow {
  id: string
  tipo_cable: string | null
  metraje: string | null
  desde: string | null
  hasta: string | null
  orden: number
}

interface HitoRow {
  id: string
  fecha: string | null
  descripcion: string | null
  orden: number
}

interface FotoRow {
  id: string
  storage_path: string
  file_name: string | null
  categoria: string | null
  otro_label: string | null
  captured_at: string | null
  annotated: boolean
  orden: number
}

const SELECT_NESTED =
  '*, informes(*, tramos(*), hitos(*), fotos(*))'

// ---------------------------------------------------------------------------
// Fila → AttRecord (lectura)
// ---------------------------------------------------------------------------

function fotoRowToEntry(f: FotoRow): FotoEntry {
  return {
    previewUrl: '',                 // se rellena con signed URL (paso 2)
    fileName: f.file_name ?? '',
    storagePath: f.storage_path,
    capturedAt: f.captured_at ?? '',
    annotated: f.annotated,
    categoria: f.categoria ?? '',
    otroLabel: f.otro_label ?? undefined,
  }
}

function rowToRecord(p: ProjectRow): AttRecord {
  const base = emptyAttRecord(p.id, toMs(p.created_at))
  const inf = p.informes?.[0]

  const rec: AttRecord = {
    ...base,
    id: p.id,
    createdAt: toMs(p.created_at),
    updatedAt: toMs(p.updated_at),
    estado: p.estado,
    fechaCierre: p.fecha_cierre ?? undefined,
    fechaInicio: p.fecha_inicio ?? undefined,

    // Sección 1–2 — projects
    tipoProyecto: (p.tipo_proyecto ?? '') as TipoProyecto | '',
    ott: p.ott ?? '',
    nombreProyecto: p.nombre_proyecto ?? '',
    iniciativa: p.iniciativa ?? '',
    ingenieroProyecto: p.ingeniero_proyecto ?? '',
    jefeProyecto: p.jefe_proyecto ?? '',
    comuna: p.comuna ?? '',
    direccion: p.direccion ?? '',
    region: p.region ?? '',
    contratista: p.contratista ?? '',
    coordsInicio: p.coords_inicio ?? { lat: '', lng: '' },
    coordsTermino: p.coords_termino ?? { lat: '', lng: '' },
    codigoServicio: p.codigo_servicio ?? '',
    nombreServicio: p.nombre_servicio ?? '',
  }

  if (inf) {
    const tramos = [...(inf.tramos ?? [])].sort((a, b) => a.orden - b.orden)
    const hitos = [...(inf.hitos ?? [])].sort((a, b) => a.orden - b.orden)
    const fotos = [...(inf.fotos ?? [])].sort((a, b) => a.orden - b.orden)

    rec.tituloInforme = inf.titulo_informe ?? ''
    rec.fecha = inf.fecha ?? ''
    rec.descripcionCabecera = inf.descripcion_cabecera ?? ''
    rec.instalaCMIC = inf.instala_cmic
    rec.instalaMufas = inf.instala_mufas
    rec.tieneReparacionDucto = inf.tiene_reparacion_ducto
    rec.tieneIngresoRed = inf.tiene_ingreso_red
    rec.ingresoRed = inf.ingreso_red ?? base.ingresoRed
    rec.infraestructura = inf.infraestructura ?? base.infraestructura

    rec.tramos = tramos.map<TramoCable>((t) => ({
      id: t.id,
      tipoCable: t.tipo_cable ?? '',
      metraje: t.metraje ?? '',
      desde: t.desde ?? '',
      hasta: t.hasta ?? '',
    }))
    rec.hitos = hitos.map<Hito>((h) => ({
      id: h.id,
      fecha: h.fecha ?? '',
      descripcion: h.descripcion ?? '',
    }))
    rec.fotos = fotos.map(fotoRowToEntry)

    rec.fotoAerea = inf.foto_general_path
      ? {
          previewUrl: '',
          fileName: '',
          storagePath: inf.foto_general_path,
          capturedAt: '',
          annotated: false,
          categoria: '',
        }
      : undefined
  }

  return rec
}

// ---------------------------------------------------------------------------
// AttRecord → fila (escritura)
// ---------------------------------------------------------------------------

/** Campos de `projects`. No incluye version/estado/fecha_cierre/created_by (los gestiona otro flujo: `close`/`remove`). */
function recordToProjectRow(
  r: AttRecord,
): Omit<ProjectRow, 'id' | 'created_at' | 'updated_at' | 'informes' | 'estado' | 'fecha_cierre'> {
  return {
    ott: r.ott,
    tipo_proyecto: r.tipoProyecto || null,
    nombre_proyecto: r.nombreProyecto || null,
    iniciativa: r.iniciativa || null,
    codigo_servicio: r.codigoServicio || null,
    nombre_servicio: r.nombreServicio || null,
    comuna: r.comuna || null,
    direccion: r.direccion || null,
    fecha_inicio: r.fechaInicio || null,
    region: r.region || null,
    contratista: r.contratista || null,
    ingeniero_proyecto: r.ingenieroProyecto || null,
    jefe_proyecto: r.jefeProyecto || null,
    coords_inicio: r.coordsInicio,
    coords_termino: r.coordsTermino,
  }
}

function recordToInformeRow(r: AttRecord, projectId: string): Omit<InformeRow, 'id' | 'tramos' | 'hitos' | 'fotos'> {
  return {
    project_id: projectId,
    titulo_informe: r.tituloInforme || null,
    fecha: orNull(r.fecha),
    descripcion_cabecera: r.descripcionCabecera || null,
    instala_cmic: r.instalaCMIC,
    instala_mufas: r.instalaMufas,
    tiene_reparacion_ducto: r.tieneReparacionDucto,
    tiene_ingreso_red: r.tieneIngresoRed,
    ingreso_red: r.ingresoRed,
    infraestructura: r.infraestructura,
    foto_general_path: r.fotoAerea?.storagePath ?? null,
  }
}

/** Reemplaza los tramos del informe (delete + insert, con orden explícito). */
async function replaceTramos(informeId: string, tramos: TramoCable[]): Promise<void> {
  const { error: delErr } = await supabase.from('tramos').delete().eq('informe_id', informeId)
  if (delErr) throw new Error(`tramos.delete: ${delErr.message}`)
  if (tramos.length === 0) return
  const rows = tramos.map((t, orden) => ({
    informe_id: informeId,
    tipo_cable: t.tipoCable || null,
    metraje: t.metraje || null,
    desde: t.desde || null,
    hasta: t.hasta || null,
    orden,
  }))
  const { error } = await supabase.from('tramos').insert(rows)
  if (error) throw new Error(`tramos.insert: ${error.message}`)
}

async function replaceHitos(informeId: string, hitos: Hito[]): Promise<void> {
  const { error: delErr } = await supabase.from('hitos').delete().eq('informe_id', informeId)
  if (delErr) throw new Error(`hitos.delete: ${delErr.message}`)
  if (hitos.length === 0) return
  const rows = hitos.map((h, orden) => ({
    informe_id: informeId,
    fecha: orNull(h.fecha),
    descripcion: h.descripcion || null,
    orden,
  }))
  const { error } = await supabase.from('hitos').insert(rows)
  if (error) throw new Error(`hitos.insert: ${error.message}`)
}

/**
 * Reemplaza las filas de `fotos` del informe. Solo persiste entradas ya subidas
 * (con `storagePath`); las que aún no tienen blob en Storage se ignoran hasta el
 * paso 2. TODO(paso 2): al borrar filas, limpiar también los objetos huérfanos
 * del bucket.
 */
async function replaceFotos(informeId: string, fotos: FotoEntry[]): Promise<void> {
  const persistables = fotos.filter((f) => !!f.storagePath)
  const { error: delErr } = await supabase.from('fotos').delete().eq('informe_id', informeId)
  if (delErr) throw new Error(`fotos.delete: ${delErr.message}`)
  if (persistables.length === 0) return
  const rows = persistables.map((f, orden) => ({
    informe_id: informeId,
    storage_path: f.storagePath!,
    file_name: f.fileName || null,
    categoria: f.categoria || null,
    otro_label: f.otroLabel || null,
    captured_at: orNull(f.capturedAt),
    annotated: f.annotated,
    orden,
  }))
  const { error } = await supabase.from('fotos').insert(rows)
  if (error) throw new Error(`fotos.insert: ${error.message}`)
}

// ---------------------------------------------------------------------------
// API pública (CRUD)
// ---------------------------------------------------------------------------

export const attRepo = {
  /**
   * Lista los informes visibles para el usuario (según RLS), recientes primero.
   * `estado` por defecto 'activo' (uso normal: caché editable del store). Para
   * "ver cerrados"/"ver todos" en Home se pide explícito 'cerrado'/'todos' —
   * esos resultados no se guardan en el store, son de solo consulta.
   */
  async list(opts?: { estado?: 'activo' | 'cerrado' | 'todos' }): Promise<AttRecord[]> {
    const estado = opts?.estado ?? 'activo'
    let query = supabase.from('projects').select(SELECT_NESTED).eq('area', 'ATT')
    if (estado !== 'todos') query = query.eq('estado', estado)
    const { data, error } = await query.order('updated_at', { ascending: false })
    if (error) throw new Error(`projects.list: ${error.message}`)
    return (data as ProjectRow[]).map(rowToRecord)
  },

  /** Carga un informe por id de project. `null` si no existe o la RLS lo oculta. */
  async load(id: string): Promise<AttRecord | null> {
    if (!isUuid(id)) return null
    const { data, error } = await supabase
      .from('projects')
      .select(SELECT_NESTED)
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`projects.load: ${error.message}`)
    return data ? rowToRecord(data as ProjectRow) : null
  },

  /**
   * Upsert de un informe completo (project + informe + hijos). Si `record.id` es
   * un uuid existente, actualiza; si es un id de cliente, inserta uno nuevo.
   * Devuelve el registro persistido y recargado (con el uuid canónico).
   */
  async save(record: AttRecord): Promise<AttRecord> {
    const projectPatch = recordToProjectRow(record)

    // 1. project
    let projectId: string
    if (isUuid(record.id)) {
      const { data, error } = await supabase
        .from('projects')
        .update(projectPatch)
        .eq('id', record.id)
        .select('id')
        .single()
      if (error) throw new Error(`projects.update: ${error.message}`)
      projectId = data.id
    } else {
      projectId = await insertProjectIdempotente(record.id, { ...projectPatch, area: 'ATT' })
    }

    // 2. informe (find-or-create por project_id — relación 1:1)
    const informePatch = recordToInformeRow(record, projectId)
    const { data: existingInf, error: findErr } = await supabase
      .from('informes')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()
    if (findErr) throw new Error(`informes.find: ${findErr.message}`)

    let informeId: string
    if (existingInf) {
      const { error } = await supabase
        .from('informes')
        .update(informePatch)
        .eq('id', existingInf.id)
      if (error) throw new Error(`informes.update: ${error.message}`)
      informeId = existingInf.id
    } else {
      const userId = await currentUserId()
      const { data, error } = await supabase
        .from('informes')
        .insert({ ...informePatch, created_by: userId })
        .select('id')
        .single()
      if (error) throw new Error(`informes.insert: ${error.message}`)
      informeId = data.id
    }

    // 3. hijos
    await replaceTramos(informeId, record.tramos)
    await replaceHitos(informeId, record.hitos)
    await replaceFotos(informeId, record.fotos)

    // 4. recargar canónico
    const saved = await this.load(projectId)
    if (!saved) throw new Error('save: no se pudo recargar el informe recién guardado')
    return saved
  },

  /** Borra un informe (el cascade de `projects` arrastra informe + hijos). Ver `removeProject`. */
  remove: removeProject,

  /** "Cierra" un informe (estado=cerrado + fecha_cierre) en vez de borrarlo. Ver `closeProject`. */
  close: closeProject,

  /** Reabre un informe cerrado. Ver `reopenProject`. */
  reopen: reopenProject,

  /**
   * Fecha de término escrita a mano desde la barra fija del Editor. Va por su
   * propio camino en vez de sumarse al payload de `save()`: ahí `fecha_cierre`
   * está excluido a propósito, para que un autoguardado normal nunca pueda
   * tocar el cierre de un proyecto (ver `recordToProjectRow`).
   */
  async setFechaCierre(projectId: string, fecha: string | null): Promise<void> {
    const { error } = await supabase.from('projects')
      .update({ fecha_cierre: fecha || null }).eq('id', projectId)
    if (error) throw new Error(`projects.setFechaCierre: ${error.message}`)
  },
}
