// SKU es texto en la BD pero se ve/ordena como número en toda la UI de
// inventario — un SKU con letras (no puramente numérico) siempre va al
// final, sin importar la dirección. Compartido entre la tabla de Bodega y
// los selectores de material (Registrar movimiento).

export function compareSku(a: string, b: string, dir: 'asc' | 'desc' = 'asc'): number {
  const na = /^\d+$/.test(a.trim()) ? Number(a) : null
  const nb = /^\d+$/.test(b.trim()) ? Number(b) : null
  if (na !== null && nb !== null) return dir === 'asc' ? na - nb : nb - na
  if (na !== null) return -1
  if (nb !== null) return 1
  const cmp = a.localeCompare(b)
  return dir === 'asc' ? cmp : -cmp
}
