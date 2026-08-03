-- Sugerencias de mejora / reportes de problema, enviados desde el botón de
-- usuario (pedido explícito de Andrés Barahona, útil de cara al mes de
-- capacitación: oficina/preventivos/ATT). Fecha y hora salen de un solo
-- `created_at` (igual que `movimientos.fecha` en el resto de la app, no hace
-- falta separarlas en dos columnas). `estado` es la sugerencia agregada por
-- Claude para poder hacer triage (mismo patrón abierto/resuelto que
-- eventos_inventario) — el autor no lo edita, solo admin/jp/log.

create table public.sugerencias (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references public.profiles(id),
  asunto     text not null,
  cuerpo     text not null,
  estado     text not null default 'pendiente' check (estado in ('pendiente', 'revisado', 'resuelto')),
  created_at timestamptz not null default now()
);
create index on public.sugerencias (usuario_id);
create index on public.sugerencias (created_at desc);

alter table public.sugerencias enable row level security;

-- Cualquier usuario autenticado puede enviar una sugerencia a su propio nombre.
create policy sugerencias_insert on public.sugerencias for insert
  with check (usuario_id = auth.uid());

-- admin/jp/log ven todas (para triage); el resto solo las que enviaron ellos.
create policy sugerencias_read on public.sugerencias for select
  using (public.is_jp_or_admin() or usuario_id = auth.uid());

-- Solo admin/jp/log cambian el estado (nadie borra: se mantiene como registro).
create policy sugerencias_update on public.sugerencias for update
  using (public.is_jp_or_admin()) with check (public.is_jp_or_admin());

grant select, insert, update on public.sugerencias to authenticated;
grant select, insert, update, delete on public.sugerencias to service_role;
