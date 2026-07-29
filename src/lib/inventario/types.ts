export interface Material {
  id: string
  sku: string
  descripcion: string
  apodo: string | null
  unidad: string | null
  categoria: string | null
  controlaLoteFisico: boolean
  activo: boolean
  /** Umbral de alerta ("hay que renovar"). null = sin umbral configurado. */
  stockMinimo: number | null
  /** Observación libre sobre el material (ej. "viene sin marcar de fábrica"). null = sin comentario. */
  comentario: string | null
  /** Solo SKUs de cable: tipo de tendido por defecto para el Estado de Pago (Subterráneo/Aéreo/...). null = no aplica/no configurado. */
  tipoTendido: string | null
  /** Solo SKUs de cable: capacidad (ej. n° de hilos) para elegir el código LPU de tendido. null = no aplica/no configurado. */
  capacidad: number | null
}

export type UbicacionTipo = 'bodega' | 'tecnico'

export interface Ubicacion {
  id: string
  nombre: string
  tipo: UbicacionTipo
  ownerUserId: string | null
  activo: boolean
}

/** Fila de `stock`, con nombres ya resueltos para pintar tablas sin joins aparte. */
export interface StockRow {
  ubicacionId: string
  ubicacionNombre: string
  materialId: string
  materialSku: string
  materialDescripcion: string
  lote: string
  cantidadFisico: number
  cantidadDigital: number
  /** Umbral de alerta del material (null = sin umbral configurado). */
  stockMinimo: number | null
  /** Observación libre del material (null = sin comentario). */
  comentario: string | null
}

/**
 * Tipo tal como lo elige el usuario en Entradas/Salidas. Se traduce a
 * `movimientos.tipo` (entrada/salida/traslado/rebaja/solicitud/instalado/
 * merma/traslado_bodega) dentro de la función `registrar_movimiento` en la
 * base de datos — ver supabase/migrations/0005_registrar_movimiento.sql
 * (tabla original) y 0037_traslado_bodega.sql (traspaso bodega↔bodega, sin
 * técnico) para el detalle de qué toca cada uno.
 */
export type MovimientoTipoUI = 'entrada' | 'solicitud' | 'entrega' | 'instalado' | 'devuelto' | 'rebajado' | 'merma' | 'traslado_bodega'

export interface Movimiento {
  id: string
  materialId: string
  materialSku: string
  materialDescripcion: string
  ubicacionId: string
  ubicacionNombre: string
  /** Solo 'traslado_bodega': la bodega de destino (la de origen es ubicacionId/ubicacionNombre). null en el resto de los tipos. */
  ubicacionDestinoId: string | null
  ubicacionDestinoNombre: string | null
  lote: string
  naturaleza: 'fisico' | 'digital'
  /** Valor guardado en BD (no el tipoUI): entrada/salida/ajuste/traslado/rebaja/solicitud/instalado. */
  tipo: string
  cantidad: number
  projectId: string | null
  projectOtt: string | null
  area: 'ATT' | 'OyM' | null
  puntoId: string | null
  usuarioId: string | null
  usuarioNombre: string | null
  fecha: string
  nota: string | null
  proveedor: string | null
  documento: string | null
  createdAt: string
}

export interface RegistrarMovimientoInput {
  tipoUI: MovimientoTipoUI
  materialId: string
  cantidad: number
  lote?: string
  fecha?: string
  nota?: string
  /** Entrada: bodega destino. Entrega/Devuelto/Rebajado: bodega origen/destino. Traslado_bodega: bodega de origen. */
  ubicacionBodegaId?: string
  /** Solo traslado_bodega: bodega de destino. */
  ubicacionBodegaDestinoId?: string
  proveedor?: string
  documento?: string
  /** Requerido en todo Salidas (solicitud/entrega/instalado/devuelto/rebajado). */
  projectId?: string
  puntoId?: string | null
  tecnicoUserId?: string
  /** Solo se usa cuando no hay proyecto (salida preventiva/insumos) — con proyecto, el área se deriva sola. */
  area?: 'ATT' | 'OyM'
}

export interface ReasignarTransitoInput {
  projectId: string
  materialId: string
  lote?: string
  puntoId?: string | null
  tecnicoUserId: string
  cantidad: number
}

/** Resumen de un material (+lote+punto) dentro de un proyecto, para la pestaña Logística. */
export interface ResumenMaterialProyecto {
  materialId: string
  materialSku: string
  materialDescripcion: string
  lote: string
  puntoId: string | null
  cantSolicitada: number
  cantEntregada: number
  cantInstalada: number
  cantDevuelta: number
  cantRezagada: number
  cantRebajada: number
  cantMerma: number
  /** Calculado: entregada - instalada - devuelta - rezagada - merma. Nunca se guarda. */
  cantTransito: number
}

/** Fila del ledger de un técnico: lo que tiene entregado/instalado/devuelto por proyecto. */
export interface TecnicoLedgerRow {
  projectId: string | null
  projectOtt: string | null
  projectArea: string | null
  materialId: string
  materialSku: string
  materialDescripcion: string
  lote: string
  cantEntregada: number
  cantInstalada: number
  cantDevuelta: number
  cantRebajada: number
  cantMerma: number
  cantTransito: number
}

// ---------------------------------------------------------------------------
// Conteo (reconciliación manual de stock)
// ---------------------------------------------------------------------------

export interface Conteo {
  id: string
  ubicacionId: string
  ubicacionNombre: string
  naturaleza: 'fisico' | 'digital'
  fecha: string
  usuarioId: string | null
  usuarioNombre: string | null
  estado: 'abierto' | 'cerrado'
  nota: string | null
  createdAt: string
}

export interface ConteoLinea {
  id: string
  conteoId: string
  materialId: string
  materialSku: string
  materialDescripcion: string
  lote: string
  cantidadContada: number
  cantidadSistema: number
  /** True si la línea se agregó manualmente o por import (nunca antes con stock aquí): al cerrar no genera evento de diferencia. */
  primeraVez: boolean
}

/**
 * Entrada libre de la pestaña "Observaciones" de un proyecto: notas generales
 * (ej. material instalado que no quedó registrado como entregado, para que
 * oficina lo corrija). Sin edición — solo agregar/borrar.
 */
export interface Observacion {
  id: string
  projectId: string
  /** Solo Preventivos: si viene, es un comentario de ESE punto, no general del proyecto. */
  puntoId: string | null
  usuarioId: string
  usuarioNombre: string | null
  texto: string
  createdAt: string
}

export type ResolucionEvento = 'devolucion_pendiente' | 'reubicacion' | 'perdida'

export interface EventoInventario {
  id: string
  conteoLineaId: string | null
  materialId: string
  materialSku: string
  materialDescripcion: string
  ubicacionId: string
  ubicacionNombre: string
  lote: string
  diferencia: number
  estado: 'abierto' | 'resuelto'
  resolucion: ResolucionEvento | null
  nota: string | null
  resueltoPor: string | null
  fechaResolucion: string | null
  createdAt: string
}
