import type { Punto } from '../types'

// Criterio (definido por Andrés): un punto está cerrado si no tiene hallazgo
// (nada que corregir) o si se marcó manualmente como cerrado ("Punto
// cerrado"). Abierto = tiene un hallazgo real y todavía no se marca cerrado.
export function isPuntoCerrado(punto: Punto): boolean {
  return punto.hallazgo === '' || !!punto.resuelto
}
