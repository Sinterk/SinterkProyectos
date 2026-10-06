/**
 * Un material es "insumo" si su Tipo del Catálogo se llama "Insumo" (Amarras,
 * huincha, fleje, alcohol isopropílico…). De los insumos solo se reporta la
 * ENTREGA: su consumo no se informa, así que nunca se instalan, devuelven ni
 * dan de merma, y lo entregado no cuenta como "tránsito" pendiente (decisión
 * de Andrés, 06-10). Solo queda el registro de a qué técnico se le entregó.
 */
export function esTipoInsumo(nombreTipo: string | null | undefined): boolean {
  const n = nombreTipo?.trim().toLowerCase()
  return n === 'insumo' || n === 'insumos'
}
