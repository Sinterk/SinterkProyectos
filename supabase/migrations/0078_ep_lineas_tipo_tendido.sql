-- Estado de Pago: "Tipo de tendido" por línea (pedido de Andrés, 05-10-2026).
--
-- La hoja de informe del Excel de Entel tiene 4 columnas manuales: código,
-- cantidad informada, observaciones y tipo de tendido. Las 3 primeras ya
-- estaban en ep_lineas; esta agrega la cuarta. Solo se llena en las líneas
-- que son tendido (cable): sale del campo tipo_tendido del material.
--
-- Nullable y sin default: las líneas existentes y las que no son tendido
-- quedan en null. Compatible con el cliente anterior (no manda la columna).

alter table public.ep_lineas
  add column if not exists tipo_tendido text;
