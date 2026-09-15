-- Pedido de Andrés: diferenciar qué hallazgos corrige la brigada de Línea y
-- cuáles la de OyM. Cada TIPO de hallazgo tiene una brigada por defecto,
-- editable en Administración (misma tabla-catálogo que ya usa
-- correccion/orden/activo — ver 0068_catalogo_hallazgos.sql); al elegir el
-- hallazgo en un punto, esa brigada se copia igual que ya pasa con el texto
-- de Corrección, y queda editable por punto (mismo patrón, ver
-- handleHallazgoChange en PuntoCard.tsx).
--
-- Todo el catálogo existente arranca en 'oym' — no hay forma de inferir cuál
-- de los 23 hallazgos corrige cada brigada desde los datos ya guardados;
-- Andrés los va a repasar uno por uno desde Administración.

alter table public.correcciones_hallazgo
  add column if not exists brigada text not null default 'oym'
  check (brigada in ('linea', 'oym'));

alter table public.puntos
  add column if not exists brigada text
  check (brigada is null or brigada in ('linea', 'oym'));
