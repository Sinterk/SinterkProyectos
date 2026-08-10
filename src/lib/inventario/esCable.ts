/**
 * Un material es "cable" si su Tipo del Catálogo se llama "Cable ..." (Cable
 * ADSS, Cable ducto, Cable autosoportado — ver 0044_catalogo_materiales.sql).
 *
 * Vive acá para que haya UNA sola regla: la usan el Estado de Pago (para
 * decidir si el proyecto tendió cable) y los totales de la lista de ATT. No
 * se usa `tipo_tendido` como proxy: ese campo es la clave de búsqueda en
 * `lpu_tendido_map`, se configura aparte y no todos los cables lo tienen.
 */
export function esTipoCable(nombreTipo: string | null | undefined): boolean {
  return !!nombreTipo && nombreTipo.toLowerCase().startsWith('cable ')
}
