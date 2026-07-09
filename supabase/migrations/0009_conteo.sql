-- Función de Conteo (reconciliación manual de stock) usando las tablas ya
-- presentes desde 0001_init.sql (conteos/conteo_lineas/eventos_inventario).
-- Mismo criterio que registrar_movimiento: lógica atómica en la BD, no en
-- el cliente — abrir/cerrar un conteo toca varias tablas a la vez y debe
-- quedar todo o nada.
--
-- Flujo: abrir_conteo (toma foto del stock actual de una ubicación+naturaleza
-- en conteo_lineas) → el usuario edita cantidad_contada por línea (y puede
-- agregar líneas para material encontrado que no estaba en el sistema) →
-- cerrar_conteo (por cada línea con diferencia: ajusta stock a lo contado y
-- abre un evento en eventos_inventario) → resolver_evento_inventario cierra
-- cada evento con una causa.

set check_function_bodies = off;

create or replace function public.abrir_conteo(
  p_ubicacion_id uuid, p_naturaleza text, p_nota text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conteo_id uuid;
begin
  if p_naturaleza not in ('fisico', 'digital') then
    raise exception 'Naturaleza inválida: %', p_naturaleza;
  end if;
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para abrir un conteo';
  end if;

  insert into public.conteos (ubicacion_id, naturaleza, usuario_id, estado, nota)
  values (p_ubicacion_id, p_naturaleza, auth.uid(), 'abierto', p_nota)
  returning id into v_conteo_id;

  -- Foto del sistema al momento de abrir: una línea por cada material/lote
  -- con stock distinto de cero en esa ubicación (incluye negativos, ya
  -- permitidos desde la migración 0008). cantidad_contada arranca igual a
  -- cantidad_sistema para que "sin diferencia" sea el estado por defecto.
  if p_naturaleza = 'fisico' then
    insert into public.conteo_lineas (conteo_id, material_id, lote, cantidad_contada, cantidad_sistema)
    select v_conteo_id, s.material_id, s.lote, s.cantidad_fisico, s.cantidad_fisico
    from public.stock s
    where s.ubicacion_id = p_ubicacion_id and s.cantidad_fisico <> 0;
  else
    insert into public.conteo_lineas (conteo_id, material_id, lote, cantidad_contada, cantidad_sistema)
    select v_conteo_id, s.material_id, s.lote, s.cantidad_digital, s.cantidad_digital
    from public.stock s
    where s.ubicacion_id = p_ubicacion_id and s.cantidad_digital <> 0;
  end if;

  return v_conteo_id;
end;
$$;

-- Agrega una línea manual (material encontrado que el sistema tenía en 0,
-- por eso no salió en la foto inicial).
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

  insert into public.conteo_lineas (conteo_id, material_id, lote, cantidad_contada, cantidad_sistema)
  values (p_conteo_id, p_material_id, v_lote, 0, 0)
  returning id into v_linea_id;

  return v_linea_id;
end;
$$;

create or replace function public.actualizar_linea_conteo(
  p_linea_id uuid, p_cantidad_contada numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
begin
  select c.estado into v_estado
  from public.conteo_lineas cl join public.conteos c on c.id = cl.conteo_id
  where cl.id = p_linea_id;
  if v_estado is null then raise exception 'Línea de conteo no encontrada'; end if;
  if v_estado <> 'abierto' then raise exception 'El conteo ya está cerrado'; end if;
  if not public.can_move_inventory() then raise exception 'No tienes permiso para editar este conteo'; end if;

  update public.conteo_lineas set cantidad_contada = p_cantidad_contada where id = p_linea_id;
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
    select id, material_id, lote, cantidad_contada, cantidad_sistema
    from public.conteo_lineas where conteo_id = p_conteo_id
  loop
    v_diferencia := v_linea.cantidad_contada - v_linea.cantidad_sistema;
    if v_diferencia <> 0 then
      if v_naturaleza = 'fisico' then
        perform public.adjust_stock(v_ubicacion_id, v_linea.material_id, v_linea.lote, v_diferencia, 0);
      else
        perform public.adjust_stock(v_ubicacion_id, v_linea.material_id, v_linea.lote, 0, v_diferencia);
      end if;

      insert into public.eventos_inventario (conteo_linea_id, material_id, ubicacion_id, lote, diferencia, estado)
      values (v_linea.id, v_linea.material_id, v_ubicacion_id, v_linea.lote, v_diferencia, 'abierto');
    end if;
  end loop;

  update public.conteos set estado = 'cerrado' where id = p_conteo_id;
end;
$$;

create or replace function public.resolver_evento_inventario(
  p_evento_id uuid, p_resolucion text, p_nota text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_resolucion not in ('devolucion_pendiente', 'reubicacion', 'perdida') then
    raise exception 'Resolución inválida: %', p_resolucion;
  end if;
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para resolver este evento';
  end if;

  update public.eventos_inventario
  set estado = 'resuelto', resolucion = p_resolucion, nota = coalesce(p_nota, nota),
      resuelto_por = auth.uid(), fecha_resolucion = now()
  where id = p_evento_id and estado = 'abierto';

  if not found then
    raise exception 'Evento no encontrado o ya resuelto';
  end if;
end;
$$;

grant execute on function public.abrir_conteo(uuid, text, text) to authenticated;
grant execute on function public.agregar_linea_conteo(uuid, uuid, text) to authenticated;
grant execute on function public.actualizar_linea_conteo(uuid, numeric) to authenticated;
grant execute on function public.cerrar_conteo(uuid) to authenticated;
grant execute on function public.resolver_evento_inventario(uuid, text, text) to authenticated;
