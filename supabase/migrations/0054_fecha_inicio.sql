-- Barra de datos siempre visible arriba de las pestañas del informe ATT
-- (OTT / Dirección / Fecha de inicio / Fecha de término), pedido de Andrés.
--
-- `direccion` ya existía (se agregó en 0021_incidencias.sql y la comparten
-- todas las áreas, solo que ATT nunca la mapeó). `fecha_cierre` también
-- existe desde 0001. La única que falta es la de inicio: por defecto se
-- muestra la fecha de creación de la OTT, pero tiene que poder escribirse a
-- mano, así que necesita columna propia — si se dedujera siempre de
-- `created_at` no habría dónde guardar el valor corregido.
alter table public.projects add column if not exists fecha_inicio date;
