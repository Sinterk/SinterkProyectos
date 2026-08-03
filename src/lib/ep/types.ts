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
  origen: EpLineaOrigen
}

/**
 * Línea sugerida en vivo por `calcularAvanceEp` — todavía no es un `EpLinea`
 * (no tiene id/orden, no está guardada). Fuentes cubiertas: (a) materiales
 * instalados vía `lpu_material_map`, (b) metros tendidos vía
 * `lpu_tendido_map`. (c) Eventos/Hitos queda deliberadamente fuera (ver
 * docs/CONTINUAR-BACKEND.md — "indagar un poco más" antes de definir).
 */
export interface EpLineaSugerida {
  lpuCodigoId: string
  codigoAtt: string
  descripcion: string
  unidad: string | null
  precioUnitario: number
  cantidad: number
}
