-- Estado de Pago (EP): al cerrar un OTT, autogenerar el borrador de líneas
-- del EP (código LPU + cantidad + tipo de tendido + observaciones) en vez de
-- que el JP llene el Excel mensual a mano desde cero.
--
-- Modelo de versiones (decisión ya confirmada con Andrés Barahona): el
-- "avance" NUNCA se guarda tal cual — se recalcula en vivo desde
-- tramos + proyecto_materiales + lpu_material_map/lpu_tendido_map + los
-- precios ACTUALES de lpu_codigos, cada vez que se pide (botón "regenerar
-- avance"). Solo lo que el JP revisa y confirma se escribe en ep_lineas,
-- con descripcion/precio_unitario CONGELADOS al guardar — así un reajuste
-- de precio LPU posterior no altera un EP ya enviado a Entel.
--
-- Alcance de RLS: igual que lpu_codigos (0031) — esto es información de
-- facturación, no de terreno. jp/admin, no técnicos.

-- material_id → lpu_codigo_id: dispara la sugerencia de línea LPU al ver que
-- el proyecto usó ese material (ej. mufa/CMIC-ODF → línea de "empalmes").
-- Un material puede sugerir más de un código (mufa → confección + fusión),
-- por eso no hay unique en material_id solo.
create table public.lpu_material_map (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.materiales(id) on delete cascade,
  lpu_codigo_id uuid not null references public.lpu_codigos(id) on delete cascade,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (material_id, lpu_codigo_id)
);
create index on public.lpu_material_map (material_id);

-- (tipo_cable, tipo_tendido) → lpu_codigo_id. tipo_cable calza con
-- tramos.tipo_cable (texto libre, ver 0001_init.sql); tipo_tendido es el
-- selector manual que el JP elige en el sitio (igual que la columna "Tipo
-- de Tendido" del Excel) — sin check constraint todavía porque la lista
-- real de valores del desplegable no está confirmada.
create table public.lpu_tendido_map (
  id            uuid primary key default gen_random_uuid(),
  tipo_cable    text not null,
  tipo_tendido  text not null,
  lpu_codigo_id uuid not null references public.lpu_codigos(id) on delete cascade,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tipo_cable, tipo_tendido)
);

-- Un registro por OTT (project_id ya es la fila versionada específica, ver
-- projects.unique(ott,version) en 0001_init.sql — no hace falta repetir el
-- versionado acá).
create table public.ep_informes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  tipo_tendido text,
  estado       text not null default 'borrador' check (estado in ('borrador','guardado')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id)
);
create trigger ep_informes_updated before update on public.ep_informes
  for each row execute function public.set_updated_at();

-- Líneas confirmadas por el JP. codigo_att/descripcion/unidad/precio_unitario
-- son copia congelada al momento de guardar (no se leen por join a
-- lpu_codigos en el momento de mostrar un EP ya guardado) — por eso
-- lpu_codigo_id es nullable con on delete set null: perder el vínculo al
-- catálogo no debe borrar ni invalidar una línea ya facturada.
create table public.ep_lineas (
  id             uuid primary key default gen_random_uuid(),
  ep_informe_id  uuid not null references public.ep_informes(id) on delete cascade,
  lpu_codigo_id  uuid references public.lpu_codigos(id) on delete set null,
  codigo_att     text not null,
  descripcion    text not null,
  unidad         text,
  precio_unitario numeric not null default 0,
  cantidad       numeric not null default 0,
  observaciones  text,
  origen         text not null default 'manual' check (origen in ('auto','manual')),
  orden          int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.ep_lineas (ep_informe_id);
create trigger ep_lineas_updated before update on public.ep_lineas
  for each row execute function public.set_updated_at();

alter table public.lpu_material_map enable row level security;
alter table public.lpu_tendido_map  enable row level security;
alter table public.ep_informes      enable row level security;
alter table public.ep_lineas        enable row level security;

create policy lpu_material_map_read  on public.lpu_material_map for select using (public.is_jp_or_admin());
create policy lpu_material_map_write on public.lpu_material_map for all    using (public.is_admin()) with check (public.is_admin());

create policy lpu_tendido_map_read  on public.lpu_tendido_map for select using (public.is_jp_or_admin());
create policy lpu_tendido_map_write on public.lpu_tendido_map for all    using (public.is_admin()) with check (public.is_admin());

-- ep_informes/ep_lineas: jp/admin leen y editan (el JP es quien confirma el
-- EP, no el técnico en terreno — a diferencia de `informes`, que sí es
-- editable por el técnico miembro del proyecto).
create policy ep_informes_all on public.ep_informes for all
  using (public.is_jp_or_admin()) with check (public.is_jp_or_admin());
create policy ep_lineas_all on public.ep_lineas for all
  using (public.is_jp_or_admin()) with check (public.is_jp_or_admin());

grant select, insert, update, delete on public.lpu_material_map to authenticated;
grant select, insert, update, delete on public.lpu_tendido_map  to authenticated;
grant select, insert, update, delete on public.ep_informes      to authenticated;
grant select, insert, update, delete on public.ep_lineas        to authenticated;
