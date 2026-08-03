// Sugerencias de mejora / reportes de problema enviados desde el botón de
// usuario — ver supabase/migrations/0041_sugerencias.sql. `estado` es para
// que admin/jp/log puedan hacer triage (mismo patrón abierto/resuelto que
// eventos_inventario); el autor no lo edita.

export type SugerenciaEstado = 'pendiente' | 'revisado' | 'resuelto'

export const SUGERENCIA_ESTADO_LABELS: Record<SugerenciaEstado, string> = {
  pendiente: 'Pendiente',
  revisado: 'Revisado',
  resuelto: 'Resuelto',
}

export interface Sugerencia {
  id: string
  usuarioId: string
  usuarioNombre: string | null
  usuarioEmail: string | null
  asunto: string
  cuerpo: string
  estado: SugerenciaEstado
  createdAt: string
}

export interface CrearSugerenciaInput {
  asunto: string
  cuerpo: string
}
