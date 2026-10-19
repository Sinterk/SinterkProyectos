/**
 * Resuelve un id que pudo quedar obsoleto por un `rekey` del store (borrador
 * local nanoid → uuid del servidor, en el primer guardado de un informe nuevo).
 *
 * Bug real reportado por Andrés (ATT, y lo mismo en Preventivos e
 * Incidencias): al escribir la OTT de un informe nuevo, el campo perdía el
 * foco a mitad de tipeo y lo que se seguía escribiendo se perdía. Causa,
 * confirmada en el navegador con un MutationObserver: `rekey` borra
 * `records[idViejo]` y crea `records[uuid]`, pero la URL (y con ella el id
 * que usa el Editor) recién se pone al día un render después, cuando
 * `navigate` termina. En ese render intermedio `records[idViejo]` no existe:
 * en ATT las secciones de "Info de proyecto" devolvían `null` (se
 * desmontaban con el input enfocado adentro y se volvían a montar vacías de
 * foco), y en Preventivos/Incidencias se desmontaba el editor completo.
 *
 * Con este alias el id viejo sigue apuntando al registro durante esa
 * transición, así que el árbol de React no cambia y el input conserva foco,
 * cursor y lo tecleado. Los alias viven solo en memoria (no van en
 * `partialize`): después de un reload la URL ya tiene el uuid.
 */
export function resolveRecordId(
  s: { records: Record<string, unknown>; aliases: Record<string, string> },
  id: string,
): string {
  return id in s.records ? id : (s.aliases[id] ?? id)
}
