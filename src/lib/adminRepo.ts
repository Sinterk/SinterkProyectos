// Capa de datos para la pantalla de administración: perfiles (rol/área/activo)
// y equipo asignado por proyecto (project_members). La creación del login en
// sí (auth.users) sigue siendo manual en el dashboard de Supabase — requiere
// la service_role key, que no se expone en el bundle del cliente. El trigger
// `handle_new_user` crea el `profiles` correspondiente automáticamente
// (rol 'tecnico' por defecto); esta capa solo edita lo que ya existe.

import { supabase } from './supabaseClient'
import type { Profile } from './auth'

export interface ProjectSummary {
  id: string
  ott: string
  nombreProyecto: string | null
  area: 'ATT' | 'OyM'
  comuna: string | null
}

export interface MemberProfile {
  id: string
  nombre: string | null
  email: string | null
}

interface MemberRow {
  user_id: string
  // El cliente sin tipos generados infiere el embed como array aunque la FK sea 1:1.
  profiles: { id: string; nombre: string | null; email: string | null }[]
}

export const adminRepo = {
  /** Todos los perfiles (solo admin puede leer todos, por RLS). */
  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nombre, email, rol, area, activo')
      .order('nombre', { ascending: true })
    if (error) throw new Error(`profiles.list: ${error.message}`)
    return data as Profile[]
  },

  /** Edita nombre/rol/área/activo de un perfil existente. */
  async updateProfile(
    id: string,
    patch: Partial<Pick<Profile, 'nombre' | 'rol' | 'area' | 'activo'>>,
  ): Promise<void> {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) throw new Error(`profiles.update: ${error.message}`)
  },

  /** Proyectos activos (ATT y OyM), para el selector de "equipo por proyecto". */
  async listActiveProjects(): Promise<ProjectSummary[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('id, ott, nombre_proyecto, area, comuna')
      .eq('estado', 'activo')
      .order('area', { ascending: true })
      .order('ott', { ascending: true })
    if (error) throw new Error(`projects.listActive: ${error.message}`)
    return (data ?? []).map((p) => ({
      id: p.id, ott: p.ott, nombreProyecto: p.nombre_proyecto, area: p.area, comuna: p.comuna,
    }))
  },

  /** Miembros (técnicos asignados) de un proyecto. */
  async listMembers(projectId: string): Promise<MemberProfile[]> {
    const { data, error } = await supabase
      .from('project_members')
      .select('user_id, profiles(id, nombre, email)')
      .eq('project_id', projectId)
    if (error) throw new Error(`project_members.list: ${error.message}`)
    return (data as unknown as MemberRow[] ?? [])
      .map((row) => row.profiles[0])
      .filter((p): p is MemberProfile => p !== undefined)
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
