-- Corrige 0031_lpu_codigos.sql tras revisar el .xlsm real
-- (eneroEP03 SINTERK ENERO2026_A.xlsm):
--
-- 1. `lpu_codigos` tiene una columna sin encabezado de texto en el Excel
--    (columna A, dos posiciones a la izquierda de "Corr") — se preserva sin
--    interpretar su significado ("importar tal cual, sin interpretar").
--
-- 2. La hoja "LPU Sup Itos obras e Itos serv" NO tiene la misma forma que
--    "LPU Obras por Zonas": no hay zonas ni código LPU, es una tabla plana
--    de ~22 prestaciones (Prestación / Valor Unit base / Reajuste $ / Valor
--    Unit final) agrupadas en 3 categorías (Supervisores EOATT, ITO OBRAS,
--    ITO Servicio Telco). `lpu_ito_precios_zona` no aplica — se elimina.

alter table public.lpu_codigos add column if not exists grupo int;

drop table if exists public.lpu_ito_precios_zona;
drop table if exists public.lpu_ito_servicios;

create table public.lpu_ito_servicios (
  id                   uuid primary key default gen_random_uuid(),
  categoria            text not null,   -- "Supervisores EOATT" | "ITO OBRAS" | "ITO Servicio Telco"
  prestacion           text not null,
  valor_unitario_base  numeric not null default 0,   -- antes de reajuste
  reajuste             numeric not null default 0,   -- monto ($), tal cual columna "Reajuste"
  valor_unitario_final numeric not null default 0,   -- tal cual la 2da columna "Valor Unit($)"
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (categoria, prestacion)
);
create trigger lpu_ito_servicios_updated before update on public.lpu_ito_servicios
  for each row execute function public.set_updated_at();

alter table public.lpu_ito_servicios enable row level security;

create policy lpu_ito_servicios_read  on public.lpu_ito_servicios for select using (public.is_jp_or_admin());
create policy lpu_ito_servicios_write on public.lpu_ito_servicios for all    using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.lpu_ito_servicios to authenticated;
