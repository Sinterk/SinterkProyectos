/**
 * Un material es "ferretería" si su Tipo del Catálogo se llama exactamente
 * "Ferretería" (sembrado en 0044_catalogo_materiales.sql). Estos materiales
 * (cruceta, tornillería, abrazaderas…) no vienen en lotes físicos
 * distinguibles en la vida real — a diferencia de cable o mufa, es un montón
 * indistinguible. Pedir lote igual generaba descuadre: cada elección
 * "cualquier lote disponible" le restaba a un lote puntual sin que hubiera
 * forma real de saber a cuál correspondía.
 *
 * Por eso el físico de estos materiales vive todo en un único lote fijo —
 * ver LOTE_FISICO_FERRETERIA — y el selector de lote deja de mostrarse en
 * los movimientos físicos (Entrega/Devolución/Instalado/Merma/Conteo/
 * Entrada). La distinción de lote real se traslada a la Rebaja (SAP,
 * digital), que es donde de verdad importa.
 */
export function esTipoFerreteria(nombreTipo: string | null | undefined): boolean {
  return nombreTipo?.trim().toLowerCase() === 'ferretería'
}

/** Lote físico único para materiales de ferretería — ver esTipoFerreteria. */
export const LOTE_FISICO_FERRETERIA = 'Físico'
