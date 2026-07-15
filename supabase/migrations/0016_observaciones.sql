-- Observaciones generales de un proyecto (pestaña "Observaciones" de
-- Logística): entradas libres, solo agregar/borrar (sin edición). Sirven,
-- entre otras cosas, para que un técnico avise de material instalado que no
-- quedó registrado como entregado, y oficina lo corrija por su cuenta.

create table public.observaciones (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  usuario_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  texto      text not null,
  created_at timestamptz not null default now()
);

create index observaciones_project_idx on public.observaciones (project_id, created_at desc);

alter table public.observaciones enable row level security;

-- Lectura/alta: admin/jp/log siempre (can_move_inventory), o el técnico
-- asignado al proyecto (is_member) — mismo criterio que el resto de
-- Logística. La alta además exige que el usuario_id sea el propio (nunca se
-- postea a nombre de otro).
create policy obs_read on public.observaciones for select
  using (public.can_move_inventory() or public.is_member(project_id));

create policy obs_insert on public.observaciones for insert
  with check (
    (public.can_move_inventory() or public.is_member(project_id))
    and usuario_id = auth.uid()
  );

-- Borrado: jp/admin puede borrar cualquiera (moderación/corrección desde
-- oficina); cualquier otro rol (técnico, log) solo la suya.
create policy obs_delete on public.observaciones for delete
  using (public.is_jp_or_admin() or usuario_id = auth.uid());
