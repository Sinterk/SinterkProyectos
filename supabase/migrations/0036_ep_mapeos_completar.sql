-- Completa el diseño de las 3 fuentes de líneas del EP acordado con Andrés
-- Barahona el 28-07-2026 (ver docs/CONTINUAR-BACKEND.md, punto 19), tras
-- crear las tablas base en 0032_estados_de_pago.sql:
--
-- (a) Materiales instalados → lpu_material_map. Faltaba el factor de
--     cantidad: un material no siempre aporta 1:1 a la cantidad LPU (ej.
--     varios tipos de ferretería pueden sumar fracciones hacia un mismo
--     código HH compartido). cantidad_sugerida_lpu = cant_instalada *
--     factor_cantidad, sumando entre todos los materiales que mapeen al
--     mismo lpu_codigo_id dentro de un EP.
--
-- (b) Metros tendidos → lpu_tendido_map. La tabla creada en 0032 usaba
--     (tipo_cable, tipo_tendido) como llave, asumido antes de la conversación
--     de diseño detallada. La llave real acordada es
--     (tipo_tendido, capacidad_min, capacidad_max): al regenerar, por cada
--     tramo se busca el material de categoría cable instalado en ESE
--     proyecto (si hay exactamente uno) y se usan SU tipo_tendido/capacidad
--     (columnas nuevas en materiales, solo se llenan para SKUs de cable) para
--     buscar el código LPU correspondiente al rango de capacidad. tipo_cable
--     no es parte de la llave — era una suposición de 0032 sin usar todavía
--     (la tabla está vacía), se reemplaza sin necesidad de migrar datos.

alter table public.materiales add column if not exists tipo_tendido text;
alter table public.materiales add column if not exists capacidad numeric;

alter table public.lpu_material_map
  add column if not exists factor_cantidad numeric not null default 1;

alter table public.lpu_tendido_map drop column if exists tipo_cable;
alter table public.lpu_tendido_map add column if not exists capacidad_min numeric;
alter table public.lpu_tendido_map add column if not exists capacidad_max numeric;

-- unique() previo era (tipo_cable, tipo_tendido); se reemplaza por la llave
-- real. Rangos min/max solapados no se validan en BD (tabla chica,
-- administrada a mano) — responsabilidad del admin al cargar el mapeo.
alter table public.lpu_tendido_map drop constraint if exists lpu_tendido_map_tipo_cable_tipo_tendido_key;
alter table public.lpu_tendido_map add constraint lpu_tendido_map_tendido_capacidad_key
  unique (tipo_tendido, capacidad_min, capacidad_max);
