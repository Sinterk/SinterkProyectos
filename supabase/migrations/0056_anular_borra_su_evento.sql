-- Anular un movimiento de "instalación forzada" quedaba bloqueado de más.
--
-- Cuando `registrar_movimiento` fuerza un Instalado sin stock, deja el
-- movimiento Y un `eventos_inventario` que lo referencia (`movimiento_id`,
-- ver 0040). En 0048 bloqueé anular cualquier movimiento con evento
-- asociado, bajo el criterio de "sin atado" que pidió Andrés — pero ese
-- evento no es una dependencia externa: existe SOLO por ese movimiento. Si
-- el movimiento se anula, el evento queda describiendo un descuadre que ya
-- no existe. Andrés lo topó limpiando una fila real:
-- "Este movimiento generó un evento de revisión — resuélvelo primero...".
--
-- Ahora anular borra también el evento que ese mismo movimiento generó. El
-- bloqueo se conserva solo para el caso que sí importa: que alguien YA haya
-- registrado resoluciones sobre ese evento (Consumo/Devolución/Traspaso/
-- Reasignación), porque cada una movió stock por su cuenta y deshacerlas
-- requiere el flujo normal.
--
-- Cuerpo idéntico al `anular_movimiento` de 0055 salvo ese bloque.
create or replace function public.anular_movimiento(p_movimiento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mov public.movimientos;
  v_ubicacion_tecnico uuid;
begin
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para anular movimientos';
  end if;

  select * into v_mov from public.movimientos where id = p_movimiento_id for update;
  if v_mov.id is null then
    raise exception 'Movimiento no encontrado';
  end if;

  -- El evento de revisión de una instalación forzada existe SOLO por este
  -- movimiento: si se anula el movimiento, el evento deja de tener sentido y
  -- se borra con él. Lo que sí bloquea es que alguien ya haya resuelto algo
  -- de ese evento — esas resoluciones movieron stock por su cuenta y hay que
  -- deshacerlas por el flujo normal de Conteo/Técnico, no desde acá.
  if exists (
    select 1
    from public.eventos_inventario_resoluciones r
    join public.eventos_inventario e on e.id = r.evento_id
    where e.movimiento_id = p_movimiento_id
  ) then
    raise exception 'Este movimiento generó un evento de revisión que ya tiene resoluciones registradas — deshazlas primero desde Conteo/Técnico';
  end if;
  -- Antes del delete del movimiento: `eventos_inventario.movimiento_id` es una
  -- FK sin cascade (ver 0040), así que dejarlo apuntando a una fila borrada
  -- reventaría con 23503.
  delete from public.eventos_inventario where movimiento_id = p_movimiento_id;
  if v_mov.evento_resolucion_id is not null then
    raise exception 'Este movimiento es la resolución de un evento de conteo — no se puede anular directo';
  end if;

  if v_mov.tipo = 'entrada' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);

  elsif v_mov.tipo = 'traslado_bodega' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    if v_mov.ubicacion_destino_id is not null then
      perform public.adjust_stock(v_mov.ubicacion_destino_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    end if;

  elsif v_mov.tipo = 'solicitud' then
    null; -- nunca tocó stock, solo registro

  elsif v_mov.tipo = 'salida' then -- Entrega: bodega -> técnico
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_entregada', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'instalado' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_instalada', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'merma' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_merma', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'traslado' then -- Devuelto: técnico -> bodega
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_devuelta', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'rebaja' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, 0, v_mov.cantidad, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_rebajada', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'ajuste' then -- Conteo
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);

  else
    raise exception 'No se sabe cómo anular movimientos de tipo %', v_mov.tipo;
  end if;

  delete from public.movimientos where id = p_movimiento_id;
end;
$$;
