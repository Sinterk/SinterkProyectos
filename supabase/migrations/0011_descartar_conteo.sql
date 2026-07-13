-- Descartar un conteo abierto (arrepentirse de haberlo abierto, o abrió la
-- ubicación/naturaleza equivocada). Solo aplica a conteos 'abierto': uno
-- 'cerrado' ya ajustó stock vía cerrar_conteo, así que borrarlo dejaría el
-- ajuste hecho sin su registro — deshacer eso requeriría revertir stock, que
-- no es el propósito de esta función. conteo_lineas se borra por cascade.

set check_function_bodies = off;

create or replace function public.descartar_conteo(p_conteo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
begin
  select estado into v_estado from public.conteos where id = p_conteo_id;
  if v_estado is null then raise exception 'Conteo no encontrado'; end if;
  if v_estado <> 'abierto' then raise exception 'Solo se puede descartar un conteo abierto'; end if;
  if not public.can_move_inventory() then raise exception 'No tienes permiso para descartar este conteo'; end if;

  delete from public.conteos where id = p_conteo_id;
end;
$$;

grant execute on function public.descartar_conteo(uuid) to authenticated;
