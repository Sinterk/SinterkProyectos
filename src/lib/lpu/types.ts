// Tipos del catálogo LPU (Lista de Precios Unitarios) y sus tablas de mapeo
// hacia materiales — base para autogenerar el borrador del Estado de
// Pago (EP) al cerrar un OTT. Ver supabase/migrations/0031, 0032, 0036 y
// docs/CONTINUAR-BACKEND.md punto 19 para el diseño completo.

/** Código del catálogo LPU, importado tal cual desde el Excel (sin interpretar). */
export interface LpuCodigo {
  id: string
  codigoAtt: string
  partida: string | null
  descripcion: string
  unidad: string | null
  tipo: string | null
  /** Tal cual viene del Excel: "VIGENTE" | "NO DISPONIBLE" | "ELIMINADO" (sin normalizar). */
  estado: string | null
}

/**
 * material_id → lpu_codigo_id: dispara la sugerencia de línea LPU al ver que
 * el proyecto usó ese material (ej. mufa → confección + fusión).
 * cantidad_sugerida_lpu = cant_instalada del material × factorCantidad,
 * sumando entre todos los materiales que mapeen al mismo código.
 */
export interface LpuMaterialMap {
  id: string
  materialId: string
  lpuCodigoId: string
  factorCantidad: number
  activo: boolean
  /** Del join a lpu_codigos, solo para mostrar — no se guarda por separado. */
  lpuCodigo: LpuCodigo | null
}

export interface LpuMaterialMapInput {
  materialId: string
  lpuCodigoId: string
  factorCantidad: number
}
