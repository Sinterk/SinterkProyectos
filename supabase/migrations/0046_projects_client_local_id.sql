-- Corrige un bug real de duplicados reportado por Andrés: un preventivo se
-- duplicó al perder conexión durante el primer guardado.
--
-- Causa raíz (misma en ATT/Preventivos/Incidencias — los 3 hacen
-- `isUuid(record.id) ? update : insert` contra `projects`, dejando que el
-- servidor genere el id): el primer guardado de un borrador nuevo (id local
-- = nanoid, no uuid) hace un `insert` sin ninguna clave estable. Si la
-- conexión se corta DESPUÉS de que ese insert ya se aplicó en el servidor
-- pero ANTES de que el cliente reciba la respuesta (típico al quedar
-- offline a mitad de un guardado), el cliente nunca se entera del uuid
-- nuevo — su registro local sigue con el nanoid viejo. El siguiente
-- reintento (autoguardado o el botón "Guardar cambios") repite el mismo
-- `insert`, creando una SEGUNDA fila con contenido igual pero id distinto:
-- el "duplicado" que se vio.
--
-- Fix: cada borrador nuevo manda su nanoid de creación como
-- `client_local_id` en el insert. Antes de insertar, el cliente busca si ya
-- existe una fila con ese `client_local_id` — si la encuentra (reintento
-- tras respuesta perdida), la usa en vez de insertar otra. El resto de la
-- cadena de guardado (informe/tramos/hitos/fotos/puntos) ya era
-- find-or-create/upsert, así que con esto el guardado completo queda
-- seguro de reintentar de punta a punta.

alter table public.projects add column if not exists client_local_id text;
alter table public.projects add constraint projects_client_local_id_key unique (client_local_id);
