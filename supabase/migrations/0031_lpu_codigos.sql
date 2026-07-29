-- Catálogo LPU (Lista de Precios Unitarios) de ATT, base para autogenerar el
-- borrador de líneas del Estado de Pago (EP) cuando se cierra un OTT.
--
-- Fuente: Excel mensual real de facturación a Entel (ej. "eneroEP03 SINTERK
-- ENERO2026_A.xlsm"), hoja "LPU Obras por Zonas" (~1130 filas) + hoja
-- separada "LPU Sup Itos obras e Itos serv". Los precios no son fijos (hay
-- reajustes), varían por zona (13 zonas geográficas de ATT) y el workbook no
-- es modular (fórmulas fijas hoja por hoja) — por eso el catálogo vive en BD
-- en vez de leerse directo del Excel cada vez.
--
-- Decisión explícita de Andrés Barahona: importar tal cual desde el Excel,
-- SIN interpretar ni mapear en esta tabla — son valores actualizables (habrá
-- reajustes de precio) que la lógica de sugerencia (lpu_material_map,
-- lpu_tendido_map, migraciones siguientes) referencia por id, no por texto.
--
-- lpu_ito_servicios espeja la misma forma que lpu_codigos/lpu_precios_zona
-- porque viene del mismo workbook LPU — a confirmar/ajustar en una migración
-- posterior si el header real de esa hoja resulta distinto una vez se
-- importen los datos.

create table public.lpu_codigos (
  id         uuid primary key default gen_random_uuid(),
  corr       int,               -- correlativo tal cual la columna "Corr" del Excel
  codigo_att text not null,     -- columna "Código ATT"
  partida    text,              -- columna "Partida"
  descripcion text not null,    -- columna "Descripción"
  unidad     text,              -- columna "Unidad"
  tipo       text,              -- columna "Tipo" (ej. FUSIONES, Otros...)
  estado     text,              -- columna "Estado", tal cual viene (sin interpretar)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.lpu_codigos (codigo_att);
create trigger lpu_codigos_updated before update on public.lpu_codigos
  for each row execute function public.set_updated_at();

-- Precio por zona, independiente por código — 13 zonas de ATT (SUR, XI
-- Región, XII Región, RM-CENTRO, V Región, Centro Sur, Copiapó, AFTA, Arica,
-- Iquique, La Serena, Calama, Centro). Sin check constraint sobre `zona`:
-- son los headers literales de la hoja "Datos" (columnas D:AE) y se
-- confirman recién al correr el script de importación contra el archivo
-- real, no antes.
create table public.lpu_precios_zona (
  id            uuid primary key default gen_random_uuid(),
  lpu_codigo_id uuid not null references public.lpu_codigos(id) on delete cascade,
  zona          text not null,
  precio        numeric,
  updated_at    timestamptz not null default now(),
  unique (lpu_codigo_id, zona)
);
create index on public.lpu_precios_zona (zona);
create trigger lpu_precios_zona_updated before update on public.lpu_precios_zona
  for each row execute function public.set_updated_at();

-- Hoja separada "LPU Sup Itos obras e Itos serv" del mismo workbook.
create table public.lpu_ito_servicios (
  id          uuid primary key default gen_random_uuid(),
  corr        int,
  codigo_att  text not null,
  partida     text,
  descripcion text not null,
  unidad      text,
  tipo        text,
  estado      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.lpu_ito_servicios (codigo_att);
create trigger lpu_ito_servicios_updated before update on public.lpu_ito_servicios
  for each row execute function public.set_updated_at();

create table public.lpu_ito_precios_zona (
  id                uuid primary key default gen_random_uuid(),
  lpu_ito_servicio_id uuid not null references public.lpu_ito_servicios(id) on delete cascade,
  zona              text not null,
  precio            numeric,
  updated_at        timestamptz not null default now(),
  unique (lpu_ito_servicio_id, zona)
);
create index on public.lpu_ito_precios_zona (zona);
create trigger lpu_ito_precios_zona_updated before update on public.lpu_ito_precios_zona
  for each row execute function public.set_updated_at();

alter table public.lpu_codigos          enable row level security;
alter table public.lpu_precios_zona     enable row level security;
alter table public.lpu_ito_servicios    enable row level security;
alter table public.lpu_ito_precios_zona enable row level security;

-- Lectura: jp/admin (catálogo interno de costos, no para técnicos).
-- Escritura: solo admin (reajustes de precio los aplica quien administra el
-- catálogo, no cada JP).
create policy lpu_codigos_read   on public.lpu_codigos for select using (public.is_jp_or_admin());
create policy lpu_codigos_write  on public.lpu_codigos for all    using (public.is_admin()) with check (public.is_admin());

create policy lpu_precios_zona_read  on public.lpu_precios_zona for select using (public.is_jp_or_admin());
create policy lpu_precios_zona_write on public.lpu_precios_zona for all    using (public.is_admin()) with check (public.is_admin());

create policy lpu_ito_servicios_read  on public.lpu_ito_servicios for select using (public.is_jp_or_admin());
create policy lpu_ito_servicios_write on public.lpu_ito_servicios for all    using (public.is_admin()) with check (public.is_admin());

create policy lpu_ito_precios_zona_read  on public.lpu_ito_precios_zona for select using (public.is_jp_or_admin());
create policy lpu_ito_precios_zona_write on public.lpu_ito_precios_zona for all    using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.lpu_codigos          to authenticated;
grant select, insert, update, delete on public.lpu_precios_zona     to authenticated;
grant select, insert, update, delete on public.lpu_ito_servicios    to authenticated;
grant select, insert, update, delete on public.lpu_ito_precios_zona to authenticated;
