// Capa de datos Incidencias: mapea Incidencia ↔ projects + incidencia_fotos
// contra Supabase. A diferencia de ATT/Preventivos no hay tabla "informe"
// intermedia — Incidencias no genera informes, así que Información vive
// directo en `projects` (ott→código, ingeniero_proyecto→ingeniero,
// direccion→dirección) y las fotos cuelgan directo de `project_id`.
//
// Convención de id: `Incidencia.id` es el uuid de `projects`. `projects.ott`
// se reutiliza como identificador visible genérico (igual que en
// Preventivos): para este módulo guarda el código de incidencia, no un OTT
// real. `area='OyM'` + `subarea='incidencia'` la distinguen de Preventivos
// (mismo area, subarea distinta) — ver 0021_incidencias.sql.

import { supabase } from '@/lib/supabaseClient'
import { removeProject, closeProject, reopenProject } from '@/lib/projectLifecycle'
import { emptyIncidencia } from '../store'
import type { Incidencia, FotoEntry } from '../types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ¿el id ya es un uuid de Postgres (registro existente) o un id de cliente? */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

/** timestamptz de Postgres → epoch ms (para createdAt/updatedAt del store). */
function toMs(ts: string | null | undefined): number {
  return ts ? Date.parse(ts) : Date.now()
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
    // Ver el comentario largo en attRepo.ts: un 23505 acá puede ser el
    // reintento por client_local_id (0046) o, antes de 0063, un choque por
    // nombre repetido (`unique(ott, version)`, que ya no aplica a esta área
    // — el código de incidencia se reutiliza entre períodos por diseño).
    const { data: existente2 } = await supabase
      .from('projects').select('id').eq('client_local_id', clientLocalId).maybeSingle()
    if (existente2) return existente2.id
    throw new Error(`projects.insert: ya existe un proyecto con el código "${String(patch.ott ?? '')}"`)
  }
  throw new Error(`projects.insert: ${error.message}`)
}

interface ProjectRow {
  id: string
  ott: string | null
  ingeniero_proyecto: string | null
  direccion: string | null
  estado: 'activo' | 'cerrado'
  fecha_cierre: string | null
  created_at: string
  updated_at: string
  incidencia_fotos?: FotoRow[]
}

interface FotoRow {
  id: string
  storage_path: string
  file_name: string | null
  captured_at: string | null
  orden: number
}

const SELECT_NESTED = '*, incidencia_fotos(*)'

function fotoRowToEntry(f: FotoRow): FotoEntry {
  return {
    previewUrl: '', // se rellena con signed URL
    fileName: f.file_name ?? '',
    storagePath: f.storage_path,
    capturedAt: f.captured_at ?? '',
  }
}

function rowToRecord(p: ProjectRow): Incidencia {
  const base = emptyIncidencia(p.id, toMs(p.created_at))
  const fotos = [...(p.incidencia_fotos ?? [])].sort((a, b) => a.orden - b.orden)
  return {
    ...base,
    id: p.id,
    createdAt: toMs(p.created_at),
    updatedAt: toMs(p.updated_at),
    estado: p.estado,
    fechaCierre: p.fecha_cierre ?? undefined,
    codigo: p.ott ?? '',
    ingeniero: p.ingeniero_proyecto ?? '',
    direccion: p.direccion ?? '',
    fotos: fotos.map(fotoRowToEntry),
  }
}

function recordToProjectRow(r: Incidencia): { ott: string; ingeniero_proyecto: string | null; direccion: string | null } {
  return {
    ott: r.codigo,
    ingeniero_proyecto: r.ingeniero || null,
    direccion: r.direccion || null,
  }
}

/** Reemplaza las fotos de la incidencia (delete + insert, con orden explícito). Solo persiste las ya subidas. */
async function replaceFotos(projectId: string, fotos: FotoEntry[]): Promise<void> {
  const persistables = fotos.filter((f) => !!f.storagePath)
  const { error: delErr } = await supabase.from('incidencia_fotos').delete().eq('project_id', projectId)
  if (delErr) throw new Error(`incidencia_fotos.delete: ${delErr.message}`)
  if (persistables.length === 0) return
  const rows = persistables.map((f, orden) => ({
    project_id: projectId,
    storage_path: f.storagePath!,
    file_name: f.fileName || null,
    captured_at: f.capturedAt || null,
    orden,
  }))
  const { error } = await supabase.from('incidencia_fotos').insert(rows)
  if (error) throw new Error(`incidencia_fotos.insert: ${error.message}`)
}

export const incidenciaRepo = {
  /**
   * Lista las incidencias visibles para el usuario (según RLS), recientes primero.
   * `estado` por defecto 'activo'; 'cerrado'/'todos' para consultas de solo lectura.
   */
  async list(opts?: { estado?: 'activo' | 'cerrado' | 'todos' }): Promise<Incidencia[]> {
    const estado = opts?.estado ?? 'activo'
    // area='OyM' + subarea='incidencia': sin el segundo filtro, se mezclaría
    // con los Preventivos reales (mismo area, la única forma de distinguirlos).
    let query = supabase.from('projects').select(SELECT_NESTED).eq('area', 'OyM').eq('subarea', 'incidencia')
    if (estado !== 'todos') query = query.eq('estado', estado)
    const { data, error } = await query.order('updated_at', { ascending: false })
    if (error) throw new Error(`projects.list: ${error.message}`)
    return (data as ProjectRow[]).map(rowToRecord)
  },

  /** Carga una incidencia por id de project. `null` si no existe o la RLS lo oculta. */
  async load(id: string): Promise<Incidencia | null> {
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
   * Upsert de una incidencia completa (project + fotos). Si `record.id` es
   * un uuid existente, actualiza; si es un id de cliente, inserta uno nuevo.
   * Devuelve el registro persistido y recargado (con el uuid canónico).
   */
  async save(record: Incidencia): Promise<Incidencia> {
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
      projectId = await insertProjectIdempotente(record.id, { ...projectPatch, area: 'OyM', subarea: 'incidencia' })
    }

    await replaceFotos(projectId, record.fotos)

    const saved = await this.load(projectId)
    if (!saved) throw new Error('save: no se pudo recargar la incidencia recién guardada')
    return saved
  },

  /** Borra una incidencia (el cascade de `projects` arrastra las fotos). */
  remove: removeProject,

  /** "Cierra" una incidencia (estado=cerrado + fecha_cierre) en vez de borrarla. */
  close: closeProject,

  /** Reabre una incidencia cerrada. */
  reopen: reopenProject,
}
