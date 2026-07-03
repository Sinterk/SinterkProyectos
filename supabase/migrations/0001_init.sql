-- =====================================================================
-- TelecomCatalog — Esquema inicial (Fase 1)
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run.
-- Bloques: extensiones · helpers · usuarios · proyectos · informes · inventario · RLS · storage
-- NOTA: SQL aún no ejecutado (proyecto Supabase por crear). Revisar al correr.
-- =====================================================================

create extension if not exists pgcrypto;

-- Permite que las funciones referencien tablas que se crean más abajo
-- (Postgres valida el cuerpo de las funciones SQL al crearlas por defecto).
set check_function_bodies = off;

-- =====================================================================
-- HELPERS
-- =====================================================================

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- rol del usuario actual — SECURITY DEFINER para no chocar con la RLS de profiles
create or replace function public.user_role()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_role() = 'admin', false)
$$;

-- admin y jp ven/editan todos los proyectos
create or replace function public.is_jp_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_role() in ('admin','jp'), false)
$$;

-- quién puede mover inventario
create or replace function public.can_move_inventory()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_role() in ('admin','jp','log'), false)
$$;

-- =====================================================================
-- USUARIOS
-- =====================================================================

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  email      text,
  rol        text not null default 'tecnico' check (rol in ('admin','jp','tecnico','log')),
  area       text check (area in ('ATT','OyM')),      -- null permitido
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- crea el profile al crear el auth.user (alta la hace el admin desde el panel/API)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    coalesce(new.raw_user_meta_data->>'rol', 'tecnico')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- PROYECTOS
-- =====================================================================

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  ott                text not null,
  version            int  not null default 1,
  copied_from_id     uuid references public.projects(id),
  area               text not null default 'ATT',
  nombre_proyecto    text,
  tipo_proyecto      text,
  iniciativa         text,
  codigo_servicio    text,
  nombre_servicio    text,
  comuna             text,
  region             text,
  contratista        text,
  ingeniero_proyecto text,
  jefe_proyecto      text,                                  -- nombre mostrado en el informe
  jefe_proyecto_id   uuid references public.profiles(id),   -- FK opcional cuando el JP sea usuario

  coords_inicio      jsonb,          -- {lat,lng}
  coords_termino     jsonb,
  estado             text not null default 'activo' check (estado in ('activo','cerrado')),
  fecha_cierre       date,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (ott, version)
);
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_members (
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);
create index on public.project_members (user_id);

-- ¿el usuario actual está asignado al proyecto?
create or replace function public.is_member(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid()
  )
$$;

-- =====================================================================
-- INFORMES (el ATT) + listas hijas
-- =====================================================================

create table public.informes (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  titulo_informe         text,
  fecha                  date,
  descripcion_cabecera   text,
  instala_cmic           boolean not null default false,
  instala_mufas          boolean not null default false,
  tiene_reparacion_ducto boolean not null default false,
  tiene_ingreso_red      boolean not null default false,
  ingreso_red            jsonb,   -- {nodo,rack,odf,fo}
  infraestructura        jsonb,   -- 5 items fijos
  foto_general_path      text,
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index on public.informes (project_id);
create trigger informes_updated before update on public.informes
  for each row execute function public.set_updated_at();

create table public.tramos (
  id         uuid primary key default gen_random_uuid(),
  informe_id uuid not null references public.informes(id) on delete cascade,
  tipo_cable text,
  metraje    text,
  desde      text,
  hasta      text,
  orden      int not null default 0
);
create index on public.tramos (informe_id);

create table public.hitos (
  id          uuid primary key default gen_random_uuid(),
  informe_id  uuid not null references public.informes(id) on delete cascade,
  fecha       date,
  descripcion text,
  orden       int not null default 0
);
create index on public.hitos (informe_id);

create table public.fotos (
  id           uuid primary key default gen_random_uuid(),
  informe_id   uuid not null references public.informes(id) on delete cascade,
  storage_path text not null,
  file_name    text,
  categoria    text,
  otro_label   text,
  captured_at  timestamptz,
  annotated    boolean not null default false,
  orden        int not null default 0
);
create index on public.fotos (informe_id);

-- ¿puede editar este informe? (jp/admin, o técnico asignado a su proyecto)
create or replace function public.can_edit_informe(inf uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_jp_or_admin() or exists(
    select 1 from public.informes i
    where i.id = inf and public.is_member(i.project_id)
  )
$$;

-- =====================================================================
-- INVENTARIO
-- =====================================================================

create table public.ubicaciones (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  tipo          text not null default 'bodega' check (tipo in ('bodega','camioneta')),
  owner_user_id uuid references public.profiles(id),   -- técnico dueño si es camioneta
  activo        boolean not null default true
);

create table public.materiales (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null unique,
  descripcion          text not null,           -- única por SKU
  apodo                text,
  unidad               text,                     -- m, unidad, kg...
  categoria            text,
  controla_lote_fisico boolean not null default false,  -- mufas true, abrazaderas false
  activo               boolean not null default true
);

-- stock DUAL por (ubicacion, material, lote)
create table public.stock (
  ubicacion_id     uuid not null references public.ubicaciones(id) on delete cascade,
  material_id      uuid not null references public.materiales(id)  on delete cascade,
  lote             text not null default '',
  cantidad_fisico  numeric not null default 0 check (cantidad_fisico  >= 0),
  cantidad_digital numeric not null default 0 check (cantidad_digital >= 0),
  primary key (ubicacion_id, material_id, lote)
);

-- libro de movimientos (trazabilidad); naturaleza separa físico vs digital
create table public.movimientos (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references public.materiales(id),
  ubicacion_id uuid not null references public.ubicaciones(id),
  lote         text not null default '',
  naturaleza   text not null check (naturaleza in ('fisico','digital')),
  tipo         text not null check (tipo in ('entrada','salida','ajuste','traslado','rebaja')),
  cantidad     numeric not null,
  project_id   uuid references public.projects(id),
  usuario_id   uuid references public.profiles(id),
  fecha        timestamptz not null default now(),
  nota         text,
  created_at   timestamptz not null default now()
);
create index on public.movimientos (material_id);
create index on public.movimientos (project_id);

-- conteos de reconciliación (físico o digital)
create table public.conteos (
  id           uuid primary key default gen_random_uuid(),
  ubicacion_id uuid not null references public.ubicaciones(id),
  naturaleza   text not null check (naturaleza in ('fisico','digital')),
  fecha        date not null default current_date,
  usuario_id   uuid references public.profiles(id),
  estado       text not null default 'abierto' check (estado in ('abierto','cerrado')),
  nota         text,
  created_at   timestamptz not null default now()
);

create table public.conteo_lineas (
  id               uuid primary key default gen_random_uuid(),
  conteo_id        uuid not null references public.conteos(id) on delete cascade,
  material_id      uuid not null references public.materiales(id),
  lote             text not null default '',
  cantidad_contada numeric not null default 0,
  cantidad_sistema numeric not null default 0   -- foto del sistema al momento del conteo
);
create index on public.conteo_lineas (conteo_id);

-- evento a resolver cuando un conteo detecta diferencia
create table public.eventos_inventario (
  id               uuid primary key default gen_random_uuid(),
  conteo_linea_id  uuid references public.conteo_lineas(id) on delete set null,
  material_id      uuid not null references public.materiales(id),
  ubicacion_id     uuid references public.ubicaciones(id),
  lote             text not null default '',
  diferencia       numeric not null,
  estado           text not null default 'abierto' check (estado in ('abierto','resuelto')),
  resolucion       text check (resolucion in ('devolucion_pendiente','reubicacion','perdida')),
  nota             text,
  resuelto_por     uuid references public.profiles(id),
  fecha_resolucion timestamptz,
  created_at       timestamptz not null default now()
);

-- ciclo de material por OTT: entregado/instalado/devuelto/rezagado/rebajado
-- tránsito = entregado - instalado - devuelto - rezagado  (calculado, no se guarda)
create table public.proyecto_materiales (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  material_id         uuid not null references public.materiales(id),
  lote                text not null default '',
  origen_ubicacion_id uuid references public.ubicaciones(id),   -- bodega o camioneta (incidencia)
  cant_entregada      numeric not null default 0,
  cant_instalada      numeric not null default 0,
  cant_devuelta       numeric not null default 0,
  cant_rezagada       numeric not null default 0,
  cant_rebajada       numeric not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, material_id, lote)
);
create index on public.proyecto_materiales (project_id);
create trigger proyecto_materiales_updated before update on public.proyecto_materiales
  for each row execute function public.set_updated_at();

-- =====================================================================
-- PRIVILEGIOS DE ROLES
-- Los roles anon/authenticated necesitan permiso base sobre las tablas;
-- la RLS (más abajo) es el filtro real de acceso a las filas.
-- =====================================================================

grant usage on schema public to anon, authenticated;
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- =====================================================================
-- RLS
-- =====================================================================

alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_members     enable row level security;
alter table public.informes            enable row level security;
alter table public.tramos              enable row level security;
alter table public.hitos               enable row level security;
alter table public.fotos               enable row level security;
alter table public.ubicaciones         enable row level security;
alter table public.materiales          enable row level security;
alter table public.stock               enable row level security;
alter table public.movimientos         enable row level security;
alter table public.conteos             enable row level security;
alter table public.conteo_lineas       enable row level security;
alter table public.eventos_inventario  enable row level security;
alter table public.proyecto_materiales enable row level security;

-- ---- profiles ----
create policy profiles_read   on public.profiles for select using (id = auth.uid() or public.is_jp_or_admin());
create policy profiles_admin  on public.profiles for all    using (public.is_admin()) with check (public.is_admin());

-- ---- projects ----  (jp/admin todo; log lee; técnico solo asignados)
create policy projects_read   on public.projects for select
  using (public.is_jp_or_admin() or public.user_role() = 'log' or public.is_member(id));
create policy projects_write  on public.projects for insert with check (public.is_jp_or_admin());
create policy projects_update on public.projects for update using (public.is_jp_or_admin()) with check (public.is_jp_or_admin());
create policy projects_delete on public.projects for delete using (public.is_admin());

-- ---- project_members ----
create policy pm_read   on public.project_members for select using (public.is_jp_or_admin() or user_id = auth.uid());
create policy pm_write  on public.project_members for insert with check (public.is_jp_or_admin());
create policy pm_delete on public.project_members for delete using (public.is_jp_or_admin());

-- ---- informes ----  (jp/admin o técnico asignado)
create policy informes_read   on public.informes for select
  using (public.is_jp_or_admin() or public.is_member(project_id));
create policy informes_write  on public.informes for insert
  with check (public.is_jp_or_admin() or public.is_member(project_id));
create policy informes_update on public.informes for update
  using (public.is_jp_or_admin() or public.is_member(project_id))
  with check (public.is_jp_or_admin() or public.is_member(project_id));
create policy informes_delete on public.informes for delete using (public.is_jp_or_admin());

-- ---- tramos / hitos / fotos ---- (siguen al informe)
create policy tramos_all on public.tramos for all using (public.can_edit_informe(informe_id)) with check (public.can_edit_informe(informe_id));
create policy hitos_all  on public.hitos  for all using (public.can_edit_informe(informe_id)) with check (public.can_edit_informe(informe_id));
create policy fotos_all  on public.fotos  for all using (public.can_edit_informe(informe_id)) with check (public.can_edit_informe(informe_id));

-- ---- inventario: lectura para cualquier autenticado; escritura solo admin/jp/log ----
create policy ubic_read on public.ubicaciones for select using (auth.uid() is not null);
create policy ubic_write on public.ubicaciones for all using (public.can_move_inventory()) with check (public.can_move_inventory());

create policy mat_read on public.materiales for select using (auth.uid() is not null);
create policy mat_write on public.materiales for all using (public.can_move_inventory()) with check (public.can_move_inventory());

create policy stock_read on public.stock for select using (auth.uid() is not null);
create policy stock_write on public.stock for all using (public.can_move_inventory()) with check (public.can_move_inventory());

create policy mov_read on public.movimientos for select using (auth.uid() is not null);
create policy mov_write on public.movimientos for all using (public.can_move_inventory()) with check (public.can_move_inventory());

create policy conteos_read on public.conteos for select using (auth.uid() is not null);
create policy conteos_write on public.conteos for all using (public.can_move_inventory()) with check (public.can_move_inventory());

create policy cl_read on public.conteo_lineas for select using (auth.uid() is not null);
create policy cl_write on public.conteo_lineas for all using (public.can_move_inventory()) with check (public.can_move_inventory());

create policy ev_read on public.eventos_inventario for select using (auth.uid() is not null);
create policy ev_write on public.eventos_inventario for all using (public.can_move_inventory()) with check (public.can_move_inventory());

-- proyecto_materiales: jp/admin/log siempre; técnico si está asignado al proyecto (registra instalado)
create policy pmat_read  on public.proyecto_materiales for select
  using (public.can_move_inventory() or public.is_member(project_id));
create policy pmat_write on public.proyecto_materiales for all
  using (public.can_move_inventory() or public.is_member(project_id))
  with check (public.can_move_inventory() or public.is_member(project_id));

-- =====================================================================
-- STORAGE (bucket de fotos, privado)
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

create policy "fotos_read"   on storage.objects for select using (bucket_id = 'fotos' and auth.uid() is not null);
create policy "fotos_insert" on storage.objects for insert with check (bucket_id = 'fotos' and auth.uid() is not null);
create policy "fotos_update" on storage.objects for update using (bucket_id = 'fotos' and auth.uid() is not null);
create policy "fotos_delete" on storage.objects for delete using (bucket_id = 'fotos' and auth.uid() is not null);

-- =====================================================================
-- SEED opcional (descomentar para arrancar con una bodega central)
-- =====================================================================
-- insert into public.ubicaciones (nombre, tipo) values ('Bodega Central', 'bodega');
