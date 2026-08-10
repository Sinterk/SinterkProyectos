import type { AttRecord } from '../types'

/**
 * Fecha de comienzo que se muestra: la escrita a mano si existe, si no la de
 * creación de la OTT. Vive acá para que la barra del Editor y la lista de
 * ATT no se contradigan (misma regla en los dos lados).
 */
export function fechaInicioDe(record: Pick<AttRecord, 'fechaInicio' | 'createdAt'>): string {
  return record.fechaInicio || new Date(record.createdAt).toISOString().slice(0, 10)
}
