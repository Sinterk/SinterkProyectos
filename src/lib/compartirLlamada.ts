/**
 * Junta llamadas idénticas que se disparan casi a la vez en UNA sola petición.
 *
 * Caso real (logs de Supabase, 15-10): un preventivo con ~40 puntos monta una
 * tarjeta por punto, y cada una pedía por su cuenta el material, el equipo y
 * el catálogo del MISMO proyecto → cientos de peticiones idénticas en un
 * minuto. Con esto, todas las que llegan dentro de `ventanaMs` desde que
 * empezó la primera comparten su resultado.
 *
 * La ventana es corta a propósito: una recarga hecha después de guardar algo
 * (acción del usuario, mucho más de 300 ms después) siempre pide datos nuevos.
 * Si la petición falla no se guarda: el siguiente intento vuelve a pedir.
 */
const enCurso = new Map<string, { at: number; promesa: Promise<unknown> }>()

export function compartirLlamada<T>(clave: string, pedir: () => Promise<T>, ventanaMs = 300): Promise<T> {
  const previa = enCurso.get(clave)
  if (previa && Date.now() - previa.at < ventanaMs) return previa.promesa as Promise<T>
  const promesa = pedir()
  enCurso.set(clave, { at: Date.now(), promesa })
  promesa.catch(() => { if (enCurso.get(clave)?.promesa === promesa) enCurso.delete(clave) })
  return promesa
}
