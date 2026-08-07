-- Anular una reasignación a preventivo no deshacía nada. Andrés lo vio así:
-- borró TODOS los movimientos de una OTT de prueba desde la ventana
-- Movimientos y aun así quedaron 2 en "Asignado a técnico" (y por lo tanto
-- −2 en Tránsito).
--
-- Causa: la reasignación ("→ preventivo", hoy la celda "Asignado a técnico")
-- escribe un movimiento con tipo='traslado' — el MISMO tipo que un Devuelto —
-- pero con `project_id` nulo y sin tocar stock: lo único que hace es sumar
-- `cant_rezagada` en `proyecto_materiales` (ver 0006). `anular_movimiento` lo
-- trataba como un Devuelto cualquiera: movía stock que nunca se había movido
-- (débito y crédito sobre la misma ubicación del técnico, neto cero) y jamás
-- devolvía el contador.
--
-- Ahora tiene su propia rama, reconocida por el código que 0051 dejó en
-- `documento` ("PREVENTIVO - <ott>") o por la nota histórica. No toca stock
-- (el original tampoco lo hizo) y devuelve `cant_rezagada` al proyecto.
--
-- LIMITACIÓN: los movimientos anteriores a 0051 no llevan ese código y el
-- movimiento no guarda `project_id`, así que no hay forma de saber a qué
-- proyecto descontarle. Esos se borran igual, y el contador se arregla a mano
-- desde la tabla del proyecto con "Corregir errores de tipeo" (0052 lo
-- habilitó justamente para esto).
--
-- Cuerpo idéntico al de 0056 salvo esa rama nueva.
create or replace function public.anular_movimiento(p_movimiento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mov public.movimientos;
  v_ubicacion_tecnico uuid;
  v_codigo_preventivo text;
  v_project_reasignado uuid;
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

  elsif v_mov.tipo = 'traslado' and (
    v_mov.documento like 'PREVENTIVO - %' or v_mov.nota = 'Reasignado a preventivo al cerrar proyecto'
  ) then
    -- Reasignación a preventivo ("Asignado a técnico"). Comparte tipo
    -- 'traslado' con Devuelto pero NO es lo mismo: no movió stock (el
    -- material ya estaba con el técnico desde la entrega, ver 0006), solo
    -- sumó `cant_rezagada` en el proyecto. Por eso su anulación tampoco toca
    -- stock — solo devuelve ese contador.
    --
    -- El movimiento va sin `project_id` a propósito, así que el proyecto se
    -- recupera del código que 0051 dejó en `documento` ("PREVENTIVO - <ott>").
    -- Los movimientos anteriores a 0051 no lo tienen: ahí no hay forma de
    -- saber a qué proyecto descontarle, se borra el movimiento igual y el
    -- contador queda para corregir a mano desde la tabla del proyecto (el
    -- modo "Corregir errores de tipeo" ya lo permite, ver 0052).
    if v_mov.documento like 'PREVENTIVO - %' then
      v_codigo_preventivo := substring(v_mov.documento from length('PREVENTIVO - ') + 1);
      select id into v_project_reasignado
        from public.projects where ott = v_codigo_preventivo
        order by version desc limit 1;
    end if;
    if v_project_reasignado is not null then
      update public.proyecto_materiales
        set cant_rezagada = greatest(cant_rezagada - v_mov.cantidad, 0)
        where project_id = v_project_reasignado
          and material_id = v_mov.material_id
          and lote = v_mov.lote;
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
