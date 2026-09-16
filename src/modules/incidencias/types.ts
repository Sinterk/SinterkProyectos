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
}
