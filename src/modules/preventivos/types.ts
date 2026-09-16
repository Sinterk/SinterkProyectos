export type FotoKey = 'fotoLevantamiento' | 'fotoAntes' | 'fotoDespues'

export interface FotoEntry {
  /** Blob URL local (se restaura desde IDB al montar, no se persiste) */
  previewUrl: string
  /** Nombre de archivo en el ZIP */
  fileName: string
  /** Clave en IndexedDB para persistir el blob entre sesiones */
  blobId?: string
  /** Ruta en el bucket `fotos` de Supabase (se llena al subir) */
  storagePath?: string
  /** Signed URL de una miniatura (200×200) de la misma foto — solo para fotos ya subidas; se usa en miniaturas/grillas, nunca en el lightbox ni en exports (ahí siempre `previewUrl`, resolución completa). */
  thumbUrl?: string
  capturedAt: string
  annotated: boolean
}

export interface CuadranteInfo {
  /** Llena el TÉCNICO */
  cuadrante: string
  comuna: string
  fotoPlano?: FotoEntry  // foto del plano/mapa de trabajo

  /** Llena el JP al revisar */
  grupo: string         // 'Equifiber' | 'Onnet'
  fecha: string
  semana: string
  semestre: string
  nombreCuadrante: string
  direccion: string
  zona: string
  responsable: string
}

export interface Punto {
  id: string
  nombre: string
  descripcion: string
  direccion: string
  correccion: string
  hallazgo: string
  /** 'linea' | 'oym' | '' (sin hallazgo) — se autocompleta al elegir el hallazgo (ver correccionesRepo.ts), editable por punto. */
  brigada: string
  resuelto: boolean
  fotoLevantamiento?: FotoEntry
  fotoAntes?: FotoEntry
  fotoDespues?: FotoEntry
}

export interface Preventivo {
  id: string
  cuadrante: CuadranteInfo
  puntos: Punto[]
  createdAt: number
  updatedAt: number
  /** Ciclo de vida en el servidor. Solo lectura desde el Editor: se cambia
   *  vía preventivoRepo.close()/remove(), nunca por un save() normal. */
  estado: 'activo' | 'cerrado'
  fechaCierre?: string
}
