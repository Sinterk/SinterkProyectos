// Capa de datos para la pantalla de administración: perfiles (rol/área/activo)
// y equipo asignado por proyecto (project_members).
//
// El alta de la cuenta en sí (auth.users) NO se hace desde acá: requiere la
// service_role key, que salta todo el RLS y no puede ir en el bundle del
// cliente, que es público. Vive en la Edge Function `crear-usuario`, y
// `crearUsuario()` más abajo es quien la llama. El trigger `handle_new_user`
// crea el `profiles` correspondiente automáticamente al aparecer la cuenta.

import type { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { Profile } from './auth'

/**
 * `functions.invoke` no lee el cuerpo cuando el status no es 2xx: tira un
 * `FunctionsHttpError` con el mensaje genérico "non-2xx status code" y deja
 * la respuesta sin consumir. El motivo real ("Ya existe un usuario con ese
 * correo", "Solo un administrador…") está en ese cuerpo.
 */
async function leerErrorDeFuncion(error: Error): Promise<string> {
  const contexto = (error as FunctionsHttpError).context
  if (!(contexto instanceof Response)) return error.message
  try {
    const cuerpo = await contexto.json()
    return typeof cuerpo?.error === 'string' ? cuerpo.error : error.message
  } catch {
    return error.message
  }
}

export interface ProjectSummary {
  id: string
  ott: string
  nombreProyecto: string | null
  area: 'ATT' | 'OyM'
  /** Solo relevante dentro de OyM: distingue Preventivos de Incidencias (ambos comparten area='OyM'). */
  subarea: 'preventivo' | 'incidencia' | null
  comuna: string | null
}

export interface MemberProfile {
  id: string
  nombre: string | null
  email: string | null
}

interface MemberRow {
  user_id: string
  // Embed vía FK hacia adelante (project_members.user_id -> profiles.id):
  // PostgREST lo devuelve como objeto simple, no array — a diferencia de un
  // embed "hacia atrás" (ej. projects.informes(...), donde la tabla hija
  // referencia a la consultada). Confirmado empíricamente contra la BD real;
  // el tipo generado por el cliente sin esquema no es de fiar para esto.
  profiles: { id: string; nombre: string | null; email: string | null } | null
}

export const adminRepo = {
  /** Todos los perfiles (solo admin puede leer todos, por RLS). */
  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nombre, email, rol, area, activo, rut, cargo')
      .order('nombre', { ascending: true })
    if (error) throw new Error(`profiles.list: ${error.message}`)
    return data as Profile[]
  },

  /**
   * Alta de un trabajador con cuenta de acceso.
   *
   * No es un insert a `profiles`: esa tabla tiene su `id` como FK a
   * `auth.users`, así que primero tiene que existir la cuenta. Crear cuentas
   * requiere la clave `service_role`, que salta todo el RLS y por eso NO
   * puede estar en la app (el bundle es público). Vive en la Edge Function
   * `crear-usuario`, que corre en el servidor de Supabase y verifica que
   * quien llama sea admin antes de usarla. Ver `supabase/functions/`.
   *
   * La fila de `profiles` la crea el trigger `handle_new_user` (0001) leyendo
   * el `user_metadata`; la función solo le completa el área después.
   */
  async crearUsuario(input: {
    email: string
    password: string
    nombre: string
    rol: Profile['rol']
    area: Profile['area']
  }): Promise<void> {
    const { data, error } = await supabase.functions.invoke('crear-usuario', { body: input })
    if (error) {
      // `invoke` devuelve un Error genérico ("non-2xx status code") y deja el
      // detalle en el cuerpo — sin esto, cualquier fallo se ve como "Edge
      // Function returned a non-2xx status code" y no se puede diagnosticar.
      const detalle = await leerErrorDeFuncion(error)
      throw new Error(`usuarios.crear: ${detalle}`)
    }
    if (data?.error) throw new Error(`usuarios.crear: ${data.error}`)
  },

  /** Edita nombre/rol/área/activo/rut/cargo de un perfil existente. */
  async updateProfile(
    id: string,
    patch: Partial<Pick<Profile, 'nombre' | 'rol' | 'area' | 'activo' | 'rut' | 'cargo'>>,
  ): Promise<void> {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) throw new Error(`profiles.update: ${error.message}`)
  },

  /** Proyectos activos (ATT y OyM), para el selector de "equipo por proyecto". */
  async listActiveProjects(): Promise<ProjectSummary[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('id, ott, nombre_proyecto, area, subarea, comuna')
      .eq('estado', 'activo')
      .order('area', { ascending: true })
      .order('ott', { ascending: true })
    if (error) throw new Error(`projects.listActive: ${error.message}`)
    return (data ?? []).map((p) => ({
      id: p.id, ott: p.ott, nombreProyecto: p.nombre_proyecto, area: p.area, subarea: p.subarea, comuna: p.comuna,
    }))
  },

  /**
   * Crea un proyecto "base" (solo `ott`+`area`, sin informe/tramos/etc.) para
   * alta rápida desde el selector de Proyecto de Registrar Movimiento, cuando
   * se escribe un código que todavía no existe. Queda como borrador mínimo —
   * el JP lo completa después abriendo el editor real de ATT/Preventivos, que
   * hace `update` sobre este mismo `id` sin problema (mismo camino que
   * cualquier proyecto ya existente). RLS de `projects` solo permite insert a
   * admin/jp (`is_jp_or_admin`) — un usuario `log` no podrá crear, solo elegir
   * entre los que ya existen.
   */
  async crearProyectoBase(ott: string, area: 'ATT' | 'OyM'): Promise<ProjectSummary> {
    const { data, error } = await supabase
      .from('projects')
      .insert({ ott: ott.trim(), area })
      .select('id, ott, nombre_proyecto, area, subarea, comuna')
      .single()
    if (error) throw new Error(`projects.crearBase: ${error.message}`)
    return {
      id: data.id, ott: data.ott, nombreProyecto: data.nombre_proyecto,
      area: data.area, subarea: data.subarea, comuna: data.comuna,
    }
  },

  /** Miembros (técnicos asignados) de un proyecto. */
  async listMembers(projectId: string): Promise<MemberProfile[]> {
    const { data, error } = await supabase
      .from('project_members')
      .select('user_id, profiles(id, nombre, email)')
      .eq('project_id', projectId)
    if (error) throw new Error(`project_members.list: ${error.message}`)
    return (data as unknown as MemberRow[] ?? [])
      .map((row) => row.profiles)
      .filter((p): p is MemberProfile => p !== null)
  },

  async addMember(projectId: string, userId: string): Promise<void> {
    const { error } = await supabase.from('project_members').insert({ project_id: projectId, user_id: userId })
    if (error) throw new Error(`project_members.add: ${error.message}`)
  },

  async removeMember(projectId: string, userId: string): Promise<void> {
    const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId)
    if (error) throw new Error(`project_members.remove: ${error.message}`)
  },
}
