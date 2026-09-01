// `Date.now()` no siempre tiene resolución de milisegundo real — varios
// navegadores (sobre todo móviles, por endurecimiento contra fingerprinting)
// redondean su precisión, así que dos llamadas hechas con poca diferencia de
// tiempo real pueden devolver el mismo valor. Los stores de ATT/Preventivos/
// Incidencias usan `updatedAt` no solo para mostrar "última edición", sino
// para decidir en `mergeFromServer` si una edición local está confirmada en
// el servidor o no (comparando por IGUALDAD contra `syncedAt`, ver el
// comentario en cada store) — si dos ediciones distintas (una local a medio
// tipear, otra que llega del servidor) coinciden en el mismo milisegundo por
// esta falta de precisión, `mergeFromServer` puede confundirlas y el
// servidor termina pisando la edición local en curso. Reportado por Andrés
// como "el texto de la OTT se corta a mitad del ingreso" — pasaba menos
// desde el fix de 8ba8f71 (que sacó la comparación de relojes distintos),
// pero seguía pasando en celular, consistente con esto.
//
// `monotonicNow()` da la hora actual igual que `Date.now()`, pero garantiza
// que cada llamada devuelve un valor ESTRICTAMENTE mayor que la anterior
// (dentro de esta pestaña) — sin importar la resolución real del reloj del
// navegador.
let last = 0
export function monotonicNow(): number {
  const now = Date.now()
  last = now > last ? now : last + 1
  return last
}
