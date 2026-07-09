-- La primera vez que se cuenta un material en una ubicación (línea agregada
-- a mano o por importación SAP, nunca antes con stock ahí) parte de
-- cantidad_sistema=0 — al cerrar, cualquier cantidad contada generaba un
-- eventos_inventario de "diferencia a revisar", pero no hay nada que
-- reconciliar: es solo la primera vez que se registra, no un descuadre.
-- cerrar_conteo sigue ajustando el stock igual, solo deja de abrir el evento.

alter table public.conteo_lineas add column if not exists primera_vez boolean not null default false;

set check_function_bodies = off;

create or replace function public.agregar_linea_conteo(
  p_conteo_id uuid, p_material_id uuid, p_lote text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lote text := coalesce(nullif(trim(p_lote), ''), 'SinDefinir');
  v_linea_id uuid;
  v_estado text;
begin
  select estado into v_estado from public.conteos where id = p_conteo_id;
  if v_estado is null then raise exception 'Conteo no encontrado'; end if;
  if v_estado <> 'abierto' then raise exception 'El conteo ya está cerrado'; end if;
  if not public.can_move_inventory() then raise exception 'No tienes permiso para editar este conteo'; end if;

  if exists (
    select 1 from public.conteo_lineas
    where conteo_id = p_conteo_id and material_id = p_material_id and lote = v_lote
  ) then
    raise exception 'Ese material/lote ya está en el conteo';
  end if;

  insert into public.conteo_lineas (conteo_id, material_id, lote, cantidad_contada, cantidad_sistema, primera_vez)
  values (p_conteo_id, p_material_id, v_lote, 0, 0, true)
  returning id into v_linea_id;

  return v_linea_id;
end;
$$;

create or replace function public.cerrar_conteo(p_conteo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ubicacion_id uuid;
  v_naturaleza text;
  v_estado text;
  v_linea record;
  v_diferencia numeric;
begin
  select ubicacion_id, naturaleza, estado into v_ubicacion_id, v_naturaleza, v_estado
  from public.conteos where id = p_conteo_id;
  if v_estado is null then raise exception 'Conteo no encontrado'; end if;
  if v_estado <> 'abierto' then raise exception 'El conteo ya está cerrado'; end if;
  if not public.can_move_inventory() then raise exception 'No tienes permiso para cerrar este conteo'; end if;

  for v_linea in
    select id, material_id, lote, cantidad_contada, cantidad_sistema, primera_vez
    from public.conteo_lineas where conteo_id = p_conteo_id
  loop
    v_diferencia := v_linea.cantidad_contada - v_linea.cantidad_sistema;
    if v_diferencia <> 0 then
      if v_naturaleza = 'fisico' then
        perform public.adjust_stock(v_ubicacion_id, v_linea.material_id, v_linea.lote, v_diferencia, 0);
      else
        perform public.adjust_stock(v_ubicacion_id, v_linea.material_id, v_linea.lote, 0, v_diferencia);
      end if;

      if not v_linea.primera_vez then
        insert into public.eventos_inventario (conteo_linea_id, material_id, ubicacion_id, lote, diferencia, estado)
        values (v_linea.id, v_linea.material_id, v_ubicacion_id, v_linea.lote, v_diferencia, 'abierto');
      end if;
    end if;
  end loop;

  update public.conteos set estado = 'cerrado' where id = p_conteo_id;
end;
$$;
