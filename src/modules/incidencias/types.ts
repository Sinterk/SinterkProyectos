export interface FotoEntry {
  previewUrl: string
  fileName: string
  blobId?: string
  storagePath?: string // ruta en el bucket `fotos` de Supabase (se llena al subir)
  /** epoch ms de cuándo se resolvió `previewUrl` — para saber si sigue vigente y se puede reusar sin volver a pedirla/descargarla (ver `isSignedUrlFresh`). */
  previewUrlAt?: number
  capturedAt: string
}

export interface Incidencia {
  id: string
  createdAt: number
  updatedAt: number
  /** Ciclo de vida en el servidor. Solo lectura desde el Editor: se cambia
   *  vía incidenciaRepo.close()/remove(), nunca por un save() normal. */
  estado: 'activo' | 'cerrado'
  fechaCierre?: string

  // Información — solo el código es obligatorio para guardar de verdad.
  codigo: string
  ingeniero: string
  direccion: string

  fotos: FotoEntry[]

  /**
   * Cuadrante (Preventivo) del que nació esta incidencia — solo si se creó al
   * cerrar un cuadrante (ver 0075_incidencia_de_preventivo.sql). El material
   * de esta incidencia ES el del cuadrante (misma tabla, sincronizada), y
   * mientras no tenga número de incidencia (`codigo` vacío) se reconoce por
   * comuna/cuadrante/semana/año.
   */
  preventivo?: PreventivoOrigen
}

export interface PreventivoOrigen {
  /** uuid del proyecto del cuadrante — contra él viven los movimientos de material. */
  id: string
  cuadrante: string
  comuna: string
  semana: string
  anio: string
}

/** Proyecto contra el que viven los movimientos de material de la incidencia: el cuadrante de origen si existe, si no ella misma. */
export function proyectoMaterialId(r: Pick<Incidencia, 'id' | 'preventivo'>): string {
  return r.preventivo?.id ?? r.id
}

/** "Comuna · Cuadrante X · Semana N · 2026" — cómo se reconoce una incidencia de preventivo que aún no tiene número. */
export function etiquetaPreventivo(p: PreventivoOrigen): string {
  return [p.comuna, p.cuadrante && `Cuadrante ${p.cuadrante}`, p.semana && `Semana ${p.semana}`, p.anio].filter(Boolean).join(' · ')
}
