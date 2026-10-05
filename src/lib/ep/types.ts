// Estado de Pago (EP) por OTT — ver supabase/migrations/0032_estados_de_pago.sql,
// 0043_ep_zona.sql y docs/CONTINUAR-BACKEND.md punto 19 para el diseño completo.
// El "avance" nunca se guarda tal cual: se recalcula en vivo desde
// tramos+materiales instalados+mapeos+precios actuales cada vez que se pide
// (ver calcularAvanceEp en epRepo.ts); solo lo que el JP confirma con
// "Guardar" queda escrito en `ep_lineas`.

export type EpLineaOrigen = 'auto' | 'manual'

export interface EpInforme {
  id: string
  projectId: string
  zona: string | null
  estado: 'borrador' | 'guardado'
  createdAt: string
  updatedAt: string
}

/** Línea ya guardada en `ep_lineas` — codigo/descripcion/precio quedan CONGELADOS al guardar. */
export interface EpLinea {
  id: string
  epInformeId: string
  lpuCodigoId: string | null
  codigoAtt: string
  descripcion: string
  unidad: string | null
  precioUnitario: number
  cantidad: number
  observaciones: string | null
  /** Solo en líneas de tendido (cable) — 4ª columna manual del Excel de Entel. null = no aplica. */
  tipoTendido: string | null
  origen: EpLineaOrigen
  orden: number
}

export interface EpLineaInput {
  lpuCodigoId: string | null
  codigoAtt: string
  descripcion: string
  unidad: string | null
  precioUnitario: number
  cantidad: number
  observaciones?: string | null
  tipoTendido?: string | null
  origen: EpLineaOrigen
}

/**
 * Línea sugerida en vivo por `calcularAvanceEp` — todavía no es un `EpLinea`
 * (no tiene id/orden, no está guardada). Única fuente: materiales instalados
 * vía `lpu_material_map`. El tendido es "un material más": el cable instalado
 * (en metros) se mapea a su código LPU igual que cualquier otro SKU, y su
 * `tipoTendido` sale del material. Eventos/Hitos queda fuera del alcance.
 */
export interface EpLineaSugerida {
  lpuCodigoId: string
  codigoAtt: string
  descripcion: string
  unidad: string | null
  precioUnitario: number
  cantidad: number
  tipoTendido: string | null
}

/** Material instalado en el proyecto que no genera ninguna línea porque no tiene código LPU activo. */
export interface MaterialSinLpu {
  sku: string
  descripcion: string
  cantidad: number
}

export interface AvanceEp {
  lineas: EpLineaSugerida[]
  sinLpu: MaterialSinLpu[]
}
