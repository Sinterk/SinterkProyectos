/**
 * Reemplaza, dentro de un arreglo de líneas (cualquier forma con `localId`),
 * la línea `localId` por varias — usado cuando se elige un paquete de
 * materiales en un `MaterialSelect` (ver `onSelectPaquete`,
 * `0069_paquetes_material.sql`): la línea donde se eligió el paquete
 * termina reemplazada por N líneas nuevas, una por SKU del paquete, en el
 * mismo lugar. Si `localId` no existe, no hace nada (defensivo).
 */
export function reemplazarLineaPorVarias<T extends { localId: string }>(
  lineas: T[], localId: string, nuevas: T[],
): T[] {
  const idx = lineas.findIndex((l) => l.localId === localId)
  if (idx === -1) return lineas
  return [...lineas.slice(0, idx), ...nuevas, ...lineas.slice(idx + 1)]
}
