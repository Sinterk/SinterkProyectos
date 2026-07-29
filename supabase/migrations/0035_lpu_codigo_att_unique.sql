-- El import (scripts/importar-lpu.mjs) hacía un find-then-insert/update por
-- cada una de las 305 filas de forma secuencial (~900 llamadas HTTP en
-- total) — muy lento y con más ventana para fallos de red transitorios.
-- Con un unique constraint sobre codigo_att se puede hacer un solo upsert
-- por lote (igual que ya se hace en lpu_ito_servicios con categoria+prestacion).

drop index if exists public.lpu_codigos_codigo_att_idx;
alter table public.lpu_codigos add constraint lpu_codigos_codigo_att_key unique (codigo_att);
