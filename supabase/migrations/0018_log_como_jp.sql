-- Decisión: LOG debe tener los mismos privilegios que JP/Oficina (antes
-- can_move_inventory() ya incluía a log para inventario, pero is_jp_or_admin()
-- no — dejaba a log sin poder ver/editar proyectos fuera de los que integra,
-- crear proyectos, gestionar project_members, ni ver todos los perfiles).
create or replace function public.is_jp_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.user_role() in ('admin','jp','log'), false)
$$;
