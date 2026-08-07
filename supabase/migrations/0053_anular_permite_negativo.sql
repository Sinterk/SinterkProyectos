-- Fix de `anular_movimiento` (0048): al revertir un movimiento, las restas
-- de stock iban sin `p_permitir_negativo`, así que anular fallaba con
-- "Stock físico insuficiente" si la ubicación ya venía en negativo — que es
-- justo el caso en que uno quiere anular. Andrés lo encontró limpiando datos
-- de prueba: "movimientos.anular: Stock físico insuficiente (hay -2, se
-- intentó restar 1)".
--
-- Anular es una corrección: tiene que poder correr siempre, incluso dejando
-- la ubicación más negativa de lo que ya estaba (el descuadre se ve en la
-- pestaña Bodega y se reconcilia por Conteo, igual que el resto de las
-- salidas desde 0050_salidas_permiten_negativo.sql).
--
-- Cuerpo idéntico al de 0048 salvo los 5 `adjust_stock` que restan, que
-- ahora pasan `p_permitir_negativo => true`.
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

  if exists (select 1 from public.eventos_inventario where movimiento_id = p_movimiento_id) then
    raise exception 'Este movimiento generó un evento de revisión — resuélvelo primero desde Conteo/Técnico antes de anularlo';
  end if;
  if v_mov.evento_resolucion_id is not null then
    raise exception 'Este movimiento es la resolución de un evento de conteo — no se puede anular directo';
  end if;

  if v_mov.tipo = 'entrada' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);

  elsif v_mov.tipo = 'traslado_bodega' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0);
    if v_mov.ubicacion_destino_id is not null then
      perform public.adjust_stock(v_mov.ubicacion_destino_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    end if;

  elsif v_mov.tipo = 'solicitud' then
    null; -- nunca tocó stock, solo registro

  elsif v_mov.tipo = 'salida' then -- Entrega: bodega -> técnico
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_entregada', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'instalado' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_instalada', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'merma' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_merma', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'traslado' then -- Devuelto: técnico -> bodega
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_devuelta', -v_mov.cantidad);
    end if;

  elsif v_mov.tipo = 'rebaja' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, 0, v_mov.cantidad);
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
