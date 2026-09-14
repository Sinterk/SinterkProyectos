import type { FotoEntry } from '../types'

export type FotoEstado = 'vacio' | 'descargando' | 'subiendo' | 'listo'

/**
 * 'descargando': existe la foto (storagePath o blobId) pero `previewUrl` aún
 * no se resolvió — puede tardar si la conexión está lenta, y sin esto se ve
 * igual que "sin foto" (bug reportado: "parece que no se subió nada").
 * 'subiendo': ya tiene preview local (blob recién capturado) pero todavía no
 * confirma `storagePath` en Supabase — se puede perder si se cierra la app.
 */
export function fotoEstadoDe(f?: FotoEntry): FotoEstado {
  if (!f) return 'vacio'
  if (!f.previewUrl) return 'descargando'
  if (f.blobId && !f.storagePath) return 'subiendo'
  return 'listo'
}
