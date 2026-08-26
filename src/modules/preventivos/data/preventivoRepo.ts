// Capa de datos Preventivos: mapea Preventivo ↔ projects + informes_preventivo
// + puntos contra Supabase. 1 cuadrante = 1 project (area='OyM') + 1
// informes_preventivo (1:1) + N puntos.
//
// Convención de id: `Preventivo.id` es el uuid de `projects`. `projects.ott`
// se reutiliza como identificador visible genérico: para este módulo guarda
// el código de cuadrante, no un OTT real.
//
// Fotos: el binario vive en Storage (bucket `fotos`). Este repo solo persiste
// filas/columnas de foto que ya tengan `storagePath`; la subida del blob y la
// resolución de signed URLs se hacen en la capa de fotos. `previewUrl` se deja
// vacío al leer (se rellena luego con la signed URL).

import { supabase } from '@/lib/supabaseClient'
import { removeProject, closeProject, reopenProject } from '@/lib/projectLifecycle'
import { emptyPreventivo } from '../store'
import type { Preventivo, Punto, FotoEntry } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * el mismo insert y creaba una fila duplicada (bug real reportado por
 * Andrés). `clientLocalId` (el nanoid de creación) se manda como columna;
 * antes de insertar se busca si ya existe una fila con ese valor — si sí,
 * es un reintento tras respuesta perdida y se usa esa fila en vez de
 * insertar otra.
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

  // Carrera: otro intento (u otra pestaña con el mismo borrador) insertó con
  // este mismo client_local_id un instante antes — se usa esa fila en vez de fallar.
  //
  // Antes de 0063, un 23505 acá también podía ser un choque por nombre de
  // cuadrante repetido (`unique(ott, version)`) — normal en Preventivos,
  // donde el mismo código se reusa cada período. Esa búsqueda por
  // client_local_id no encontraba nada (el conflicto era otra constraint)
  // y reventaba con un error de "no rows" que no explicaba nada. 0063 saca
  // esa constraint para esta área; el fallback de abajo queda como red de
  // seguridad honesta por si algún día vuelve a haber otra causa de 23505.
  if (error.code === '23505') {
    const { data: existente2 } = await supabase
      .from('projects').select('id').eq('client_local_id', clientLocalId).maybeSingle()
    if (existente2) return existente2.id
    throw new Error(`projects.insert: ya existe un proyecto con el código "${String(patch.ott ?? '')}"`)
  }
  throw new Error(`projects.insert: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Formas de fila (parcial; solo lo que tocamos)
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string
  ott: string | null
  comuna: string | null
  estado: 'activo' | 'cerrado'
  fecha_cierre: string | null
  created_at: string
  updated_at: string
  informes_preventivo?: InformePrevRow[]
}

interface InformePrevRow {
  id: string
  project_id: string
  grupo: string | null
  fecha: string | null
  semana: string | null
  semestre: string | null
  nombre_cuadrante: string | null
  direccion: string | null
  zona: string | null
  responsable: string | null
  foto_plano_path: string | null
  puntos?: PuntoRow[]
}

interface PuntoRow {
  id: string
  nombre: string | null
  descripcion: string | null
  direccion: string | null
  correccion: string | null
  hallazgo: string | null
  resuelto: boolean
  foto_levantamiento_path: string | null
  foto_antes_path: string | null
  foto_despues_path: string | null
  orden: number
}

const SELECT_NESTED = '*, informes_preventivo(*, puntos(*))'

// ---------------------------------------------------------------------------
// Fila → Preventivo (lectura)
// ---------------------------------------------------------------------------

function fotoFromPath(path: string | null): FotoEntry | undefined {
  return path ? { previewUrl: '', fileName: '', storagePath: path, capturedAt: '', annotated: false } : undefined
}

function puntoRowToPunto(p: PuntoRow): Punto {
  return {
    id: p.id,
    nombre: p.nombre ?? '',
    descripcion: p.descripcion ?? '',
    direccion: p.direccion ?? '',
    correccion: p.correccion ?? '',
    hallazgo: p.hallazgo ?? '',
    resuelto: p.resuelto,
    fotoLevantamiento: fotoFromPath(p.foto_levantamiento_path),
    fotoAntes: fotoFromPath(p.foto_antes_path),
    fotoDespues: fotoFromPath(p.foto_despues_path),
  }
}

function rowToRecord(p: ProjectRow): Preventivo {
  const base = emptyPreventivo(p.id, toMs(p.created_at))
  const inf = p.informes_preventivo?.[0]

  const rec: Preventivo = {
    ...base,
    id: p.id,
    createdAt: toMs(p.created_at),
    updatedAt: toMs(p.updated_at),
    estado: p.estado,
    fechaCierre: p.fecha_cierre ?? undefined,
    cuadrante: { ...base.cuadrante, cuadrante: p.ott ?? '', comuna: p.comuna ?? '' },
  }

  if (inf) {
    const puntos = [...(inf.puntos ?? [])].sort((a, b) => a.orden - b.orden)
    rec.cuadrante = {
      ...rec.cuadrante,
      grupo: inf.grupo ?? '',
      fecha: inf.fecha ?? '',
      semana: inf.semana ?? '',
      semestre: inf.semestre ?? '',
      nombreCuadrante: inf.nombre_cuadrante ?? '',
      direccion: inf.direccion ?? '',
      zona: inf.zona ?? '',
      responsable: inf.responsable ?? '',
      fotoPlano: fotoFromPath(inf.foto_plano_path),
    }
    rec.puntos = puntos.map(puntoRowToPunto)
  }

  return rec
}

// ---------------------------------------------------------------------------
// Preventivo → fila (escritura)
// ---------------------------------------------------------------------------

/** Campos de `projects`. No incluye area/estado/fecha_cierre (los gestiona otro flujo). */
function recordToProjectRow(r: Preventivo): { ott: string; comuna: string | null } {
  return { ott: r.cuadrante.cuadrante, comuna: r.cuadrante.comuna || null }
}

function recordToInformeRow(r: Preventivo, projectId: string) {
  const c = r.cuadrante
  return {
    project_id: projectId,
    grupo: c.grupo || null,
    fecha: orNull(c.fecha),
    semana: c.semana || null,
    semestre: c.semestre || null,
    nombre_cuadrante: c.nombreCuadrante || null,
    direccion: c.direccion || null,
    zona: c.zona || null,
    responsable: c.responsable || null,
    foto_plano_path: c.fotoPlano?.storagePath ?? null,
  }
}

/**
 * Sincroniza los puntos del informe con upsert por id (con orden explícito) —
 * NO delete+insert-de-todos: eso le asignaba un id nuevo a cada punto en
 * cada guardado (incluido cada autoguardado), huerfanando en silencio
 * cualquier `movimientos.punto_id`/`observaciones.punto_id` ya asociado a un
 * punto (`on delete set null`). Solo se borran los puntos que el usuario
 * efectivamente quitó (id ya no presente en `puntos`); el resto se upsertea
 * conservando su id, así el material/comentarios ya colgados de un punto
 * sobreviven al siguiente guardado. Solo persiste fotos ya subidas.
 *
 * `puntos.id` es uuid en la BD y este upsert manda el id del cliente tal
 * cual (a diferencia del informe, un punto no tiene rekey posterior). Si
 * alguno no es un UUID válido (visto una vez con un ZIP importado de una
 * versión vieja del sitio), el filtro `.not('id','in', ...)` de abajo
 * revienta con un casteo de Postgres que no dice cuál punto es el problema
 * — se valida antes para dar un error que sí lo diga.
 */
async function replacePuntos(informeId: string, puntos: Punto[]): Promise<void> {
  const invalido = puntos.find((p) => !isUuid(p.id))
  if (invalido) {
    throw new Error(`puntos: id inválido "${invalido.id}" en el punto "${invalido.nombre || '(sin nombre)'}" — no es un UUID`)
  }
  const idsActuales = puntos.map((p) => p.id)
  let delQuery = supabase.from('puntos').delete().eq('informe_id', informeId)
  if (idsActuales.length > 0) delQuery = delQuery.not('id', 'in', `(${idsActuales.join(',')})`)
  const { error: delErr } = await delQuery
  if (delErr) throw new Error(`puntos.delete: ${delErr.message}`)
  if (puntos.length === 0) return
  const rows = puntos.map((p, orden) => ({
    id: p.id,
    informe_id: informeId,
    nombre: p.nombre || null,
    descripcion: p.descripcion || null,
    direccion: p.direccion || null,
    correccion: p.correccion || null,
    hallazgo: p.hallazgo || null,
    resuelto: p.resuelto,
    foto_levantamiento_path: p.fotoLevantamiento?.storagePath ?? null,
    foto_antes_path: p.fotoAntes?.storagePath ?? null,
    foto_despues_path: p.fotoDespues?.storagePath ?? null,
    orden,
  }))
  const { error } = await supabase.from('puntos').upsert(rows)
  if (error) throw new Error(`puntos.upsert: ${error.message}`)
}

// ---------------------------------------------------------------------------
// API pública (CRUD)
// ---------------------------------------------------------------------------

export const preventivoRepo = {
  /**
   * Lista los levantamientos visibles para el usuario (según RLS), recientes primero.
   * `estado` por defecto 'activo'; 'cerrado'/'todos' para consultas de solo lectura.
   */
  async list(opts?: { estado?: 'activo' | 'cerrado' | 'todos' }): Promise<Preventivo[]> {
    const estado = opts?.estado ?? 'activo'
    // subarea='preventivo': sin esto, las Incidencias (también area='OyM')
    // se mezclarían acá como levantamientos vacíos.
    let query = supabase.from('projects').select(SELECT_NESTED).eq('area', 'OyM').eq('subarea', 'preventivo')
    if (estado !== 'todos') query = query.eq('estado', estado)
    const { data, error } = await query.order('updated_at', { ascending: false })
    if (error) throw new Error(`projects.list: ${error.message}`)
    return (data as ProjectRow[]).map(rowToRecord)
  },

  /** Carga un levantamiento por id de project. `null` si no existe o la RLS lo oculta. */
  async load(id: string): Promise<Preventivo | null> {
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
   * Upsert de un levantamiento completo (project + informe + puntos). Si
   * `record.id` es un uuid existente, actualiza; si es un id de cliente,
   * inserta uno nuevo. Devuelve el registro persistido y recargado.
   */
  async save(record: Preventivo): Promise<Preventivo> {
    const projectPatch = recordToProjectRow(record)

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
      projectId = await insertProjectIdempotente(record.id, { ...projectPatch, area: 'OyM', subarea: 'preventivo' })
    }

    const informePatch = recordToInformeRow(record, projectId)
    const { data: existingInf, error: findErr } = await supabase
      .from('informes_preventivo')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()
    if (findErr) throw new Error(`informes_preventivo.find: ${findErr.message}`)

    let informeId: string
    if (existingInf) {
      const { error } = await supabase
        .from('informes_preventivo')
        .update(informePatch)
        .eq('id', existingInf.id)
      if (error) throw new Error(`informes_preventivo.update: ${error.message}`)
      informeId = existingInf.id
    } else {
      const userId = await currentUserId()
      const { data, error } = await supabase
        .from('informes_preventivo')
        .insert({ ...informePatch, created_by: userId })
        .select('id')
        .single()
      if (error) throw new Error(`informes_preventivo.insert: ${error.message}`)
      informeId = data.id
    }

    await replacePuntos(informeId, record.puntos)

    const saved = await this.load(projectId)
    if (!saved) throw new Error('save: no se pudo recargar el levantamiento recién guardado')
    return saved
  },

  /** Borra un levantamiento (el cascade de `projects` arrastra informe + puntos). */
  remove: removeProject,

  /** "Cierra" un levantamiento (estado=cerrado + fecha_cierre) en vez de borrarlo. */
  close: closeProject,

  /** Reabre un levantamiento cerrado. */
  reopen: reopenProject,
}
