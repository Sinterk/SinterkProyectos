-- Módulo Incidencias: registro de materiales usados en un incidente OyM
-- (sin informes). Vive casi enteramente en `projects` (ott→código,
-- ingeniero_proyecto→ingeniero, ya existían) — solo hace falta `direccion`
-- y un discriminador para no mezclarse con Preventivos, que hasta ahora era
-- el único tipo bajo area='OyM'.

alter table public.projects add column if not exists direccion text;

-- Incidencias y Preventivos quedan como subáreas de OyM. `area` sigue
-- siendo el área real (ATT/OyM, usada también por movimientos.area del
-- PASO 29) — `subarea` es un discriminador aparte, solo relevante dentro de
-- OyM (ATT no tiene sub-tipos todavía, queda null ahí).
alter table public.projects add column subarea text
  check (subarea is null or subarea in ('preventivo', 'incidencia'));

-- Backfill: todo lo que hoy es OyM es Preventivos (Incidencias no existía).
update public.projects set subarea = 'preventivo' where area = 'OyM';

create table public.incidencia_fotos (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  storage_path text not null,
  file_name    text,
  captured_at  timestamptz,
  orden        int not null default 0
);
create index on public.incidencia_fotos (project_id);

alter table public.incidencia_fotos enable row level security;

-- Mismo patrón que `informes` (0001_init.sql): lectura/escritura para
-- admin/jp/log o miembros del proyecto; borrado reservado a admin/jp/log.
create policy incidencia_fotos_read on public.incidencia_fotos for select
  using (public.is_jp_or_admin() or public.is_member(project_id));
create policy incidencia_fotos_write on public.incidencia_fotos for insert
  with check (public.is_jp_or_admin() or public.is_member(project_id));
create policy incidencia_fotos_update on public.incidencia_fotos for update
  using (public.is_jp_or_admin() or public.is_member(project_id))
  with check (public.is_jp_or_admin() or public.is_member(project_id));
create policy incidencia_fotos_delete on public.incidencia_fotos for delete
  using (public.is_jp_or_admin());

grant select, insert, update, delete on public.incidencia_fotos to authenticated;
