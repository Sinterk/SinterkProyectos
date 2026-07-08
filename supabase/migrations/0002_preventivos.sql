-- Preventivos sobre Supabase: reutiliza `projects` (area='OyM') para heredar
-- roles/RLS/estado-cierre/project_members ya construidos para ATT. Solo se
-- agregan las tablas específicas de este dominio (cuadrante + puntos).
--
-- 1 cuadrante = 1 project (area='OyM') + 1 informes_preventivo (1:1) + N puntos.
-- `projects.ott` se reutiliza como identificador visible genérico (para OyM
-- guarda el código de cuadrante, no un OTT real — el nombre de columna es
-- histórico de cuando solo existía ATT).

set check_function_bodies = off;

create table public.informes_preventivo (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  grupo            text,           -- 'Equifiber' | 'Onnet'
  fecha            date,
  semana           text,
  semestre         text,
  nombre_cuadrante text,
  direccion        text,
  zona             text,
  responsable      text,
  foto_plano_path  text,           -- Storage: bucket `fotos`, ruta preventivos/{blobId}.jpg
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.informes_preventivo (project_id);
create trigger informes_preventivo_updated before update on public.informes_preventivo
  for each row execute function public.set_updated_at();

create table public.puntos (
  id                      uuid primary key default gen_random_uuid(),
  informe_id              uuid not null references public.informes_preventivo(id) on delete cascade,
  nombre                  text,
  descripcion             text,
  direccion               text,
  correccion              text,
  hallazgo                text,
  resuelto                boolean not null default false,
  foto_levantamiento_path text,
  foto_antes_path         text,
  foto_despues_path       text,
  orden                   int not null default 0
);
create index on public.puntos (informe_id);

-- ¿puede editar este informe de preventivo? (mismo criterio que ATT: jp/admin, o técnico asignado)
create or replace function public.can_edit_informe_prev(inf uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_jp_or_admin() or exists(
    select 1 from public.informes_preventivo i
    where i.id = inf and public.is_member(i.project_id)
  )
$$;

alter table public.informes_preventivo enable row level security;
alter table public.puntos              enable row level security;

create policy informes_prev_read   on public.informes_preventivo for select
  using (public.is_jp_or_admin() or public.is_member(project_id));
create policy informes_prev_write  on public.informes_preventivo for insert
  with check (public.is_jp_or_admin() or public.is_member(project_id));
create policy informes_prev_update on public.informes_preventivo for update
  using (public.is_jp_or_admin() or public.is_member(project_id))
  with check (public.is_jp_or_admin() or public.is_member(project_id));
create policy informes_prev_delete on public.informes_preventivo for delete
  using (public.is_jp_or_admin());

create policy puntos_all on public.puntos for all
  using (public.can_edit_informe_prev(informe_id))
  with check (public.can_edit_informe_prev(informe_id));

-- GRANT explícito: el `grant all on all tables` de 0001_init.sql fue una foto
-- del momento en que se corrió, no cubre tablas creadas después (como estas).
grant all on public.informes_preventivo to anon, authenticated;
grant all on public.puntos              to anon, authenticated;
