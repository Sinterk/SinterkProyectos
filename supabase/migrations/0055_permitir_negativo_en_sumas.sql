-- El bloqueo de stock negativo no era lo que yo creía, y por eso los parches
-- anteriores (0050, 0053) no alcanzaron.
--
-- `adjust_stock` no valida "no restes más de lo que hay": valida que el SALDO
-- RESULTANTE no quede negativo. Con una ubicación ya en −2, una llamada que
-- SUMA 1 también salta ("−2 + 1 = −1 < 0"), y el mensaje de error dice
-- "se intentó restar 1" igual, porque usa `abs()` del delta. De ahí que
-- anular una Entrega siguiera fallando después de 0053: la llamada que
-- reventaba no era la resta al técnico (ya parchada) sino la SUMA de vuelta
-- a la bodega, que estaba en −2.
--
-- Lo mismo aplicaba, latente, a `registrar_movimiento`: una Entrada a una
-- bodega en negativo habría fallado por la misma razón.
--
-- Fix: TODAS las llamadas a `adjust_stock` de estas dos funciones pasan
-- `p_permitir_negativo => true` (7 en registrar_movimiento, 6 en
-- anular_movimiento) — sumas incluidas. Desde 0050 el criterio del proyecto
-- es que el negativo se permite y se ve (rojo en Bodega, "⚠ Descuadre —
-- revisar") y se reconcilia por Conteo; la guarda ya no protegía nada, solo
-- bloqueaba correcciones. No se tocan `resolver_evento_parcial` ni
-- `cerrar_conteo`, que tienen su propia semántica.
create or replace function public.registrar_movimiento(
  p_tipo_ui text,
  p_material_id uuid,
  p_cantidad numeric,
  p_lote text default null,
  p_fecha timestamptz default null,
  p_nota text default null,
  p_ubicacion_bodega_id uuid default null,
  p_proveedor text default null,
  p_documento text default null,
  p_project_id uuid default null,
  p_punto_id uuid default null,
  p_tecnico_user_id uuid default null,
  p_area text default null,
  p_ubicacion_bodega_destino_id uuid default null
) returns public.movimientos
language plpgsql security definer set search_path = public as $$
declare
  v_lote text := coalesce(nullif(trim(p_lote), ''), 'SinDefinir');
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_ubicacion_tecnico_id uuid;
  v_movimiento_tipo text;
  v_naturaleza text;
  v_ubicacion_movimiento uuid;
  v_ubicacion_destino uuid := null;
  v_area text;
  v_row public.movimientos;
  v_authorized boolean;
  v_requiere_revision boolean := false;
  v_stock_propio numeric;
  v_otra_ubicacion_id uuid;
  v_nota_efectiva text;
begin
  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  v_authorized := public.can_move_inventory();
  if not v_authorized and p_tecnico_user_id is not null and p_tecnico_user_id = auth.uid() then
    v_authorized := (p_project_id is null) or public.is_member(p_project_id);
  end if;
  if not v_authorized then
    raise exception 'No tienes permiso para registrar este movimiento';
  end if;

  if p_project_id is not null then
    select area into v_area from public.projects where id = p_project_id;
  elsif p_area in ('ATT', 'OyM') then
    v_area := p_area;
  else
    v_area := 'OyM'; -- default histórico de "salida preventiva", sin romper el formulario existente
  end if;

  if p_tipo_ui = 'entrada' then
    if p_ubicacion_bodega_id is null then
      raise exception 'Falta la bodega de destino';
    end if;
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0, true);
    v_movimiento_tipo := 'entrada';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  elsif p_tipo_ui = 'traslado_bodega' then
    if p_ubicacion_bodega_id is null or p_ubicacion_bodega_destino_id is null then
      raise exception 'Traspaso requiere bodega de origen y de destino';
    end if;
    if p_ubicacion_bodega_id = p_ubicacion_bodega_destino_id then
      raise exception 'La bodega de origen y destino no pueden ser la misma';
    end if;
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, -p_cantidad, 0, true);
    perform public.adjust_stock(p_ubicacion_bodega_destino_id, p_material_id, v_lote, p_cantidad, 0, true);
    v_movimiento_tipo := 'traslado_bodega';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;
    v_ubicacion_destino := p_ubicacion_bodega_destino_id;

  elsif p_tipo_ui = 'solicitud' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Solicitud requiere proyecto y técnico';
    end if;
    v_ubicacion_movimiento := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    v_movimiento_tipo := 'solicitud';
    v_naturaleza := 'fisico';

  elsif p_tipo_ui = 'entrega' then
    if p_tecnico_user_id is null or p_ubicacion_bodega_id is null then
      raise exception 'Entrega requiere técnico y bodega de origen';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, -p_cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, p_cantidad, 0, true);
    if p_project_id is not null then
      perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_entregada', p_cantidad);
    end if;
    v_movimiento_tipo := 'salida';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  elsif p_tipo_ui = 'conteo' then
    -- Crédito unilateral al técnico, sin tocar bodega: se asume que la
    -- salida física ya ocurrió y solo faltaba quedar registrada en el
    -- sistema (mismo caso que la rama 'agregar' de resolver_evento_parcial
    -- en 0042_agregar_stock_tecnico.sql, pero sin requerir un evento previo).
    if p_tecnico_user_id is null then
      raise exception 'Conteo requiere técnico';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, p_cantidad, 0, true);
    v_movimiento_tipo := 'ajuste';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := v_ubicacion_tecnico_id;

  elsif p_tipo_ui = 'instalado' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Instalado requiere proyecto y técnico';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);

    select cantidad_fisico into v_stock_propio from public.stock
      where ubicacion_id = v_ubicacion_tecnico_id and material_id = p_material_id and lote = v_lote;

    if coalesce(v_stock_propio, 0) >= p_cantidad then
      perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0, true);
      v_ubicacion_movimiento := v_ubicacion_tecnico_id;
    else
      select u.id into v_otra_ubicacion_id
        from public.project_members pm
        join public.ubicaciones u on u.owner_user_id = pm.user_id and u.tipo = 'tecnico'
        join public.stock s on s.ubicacion_id = u.id and s.material_id = p_material_id and s.lote = v_lote
        where pm.project_id = p_project_id and pm.user_id <> p_tecnico_user_id and s.cantidad_fisico >= p_cantidad
        order by s.cantidad_fisico desc
        limit 1;

      if v_otra_ubicacion_id is not null then
        perform public.adjust_stock(v_otra_ubicacion_id, p_material_id, v_lote, -p_cantidad, 0, true);
        v_ubicacion_movimiento := v_otra_ubicacion_id;
      else
        perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0, true);
        v_ubicacion_movimiento := v_ubicacion_tecnico_id;
        v_requiere_revision := true;
      end if;
    end if;

    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_instalada', p_cantidad);
    v_movimiento_tipo := 'instalado';
    v_naturaleza := 'fisico';

  elsif p_tipo_ui = 'merma' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Merma requiere proyecto y técnico';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0, true);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_merma', p_cantidad);
    v_movimiento_tipo := 'merma';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := v_ubicacion_tecnico_id;

  elsif p_tipo_ui = 'devuelto' then
    if p_tecnico_user_id is null or p_ubicacion_bodega_id is null then
      raise exception 'Devuelto requiere técnico y bodega de destino';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0, true);
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0, true);
    if p_project_id is not null then
      perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_devuelta', p_cantidad);
    end if;
    v_movimiento_tipo := 'traslado';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  elsif p_tipo_ui = 'rebajado' then
    if p_project_id is null or p_tecnico_user_id is null or p_ubicacion_bodega_id is null then
      raise exception 'Rebajado requiere proyecto, técnico y bodega de origen';
    end if;
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, 0, -p_cantidad, true);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_rebajada', p_cantidad);
    v_movimiento_tipo := 'rebaja';
    v_naturaleza := 'digital';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  else
    raise exception 'Tipo de movimiento no reconocido: %', p_tipo_ui;
  end if;

  v_nota_efectiva := p_nota;
  if v_requiere_revision then
    v_nota_efectiva := coalesce(p_nota || ' — ', '') || 'Instalación forzada: sin stock suficiente en el proyecto ni en el equipo asignado.';
  end if;

  insert into public.movimientos (
    material_id, ubicacion_id, ubicacion_destino_id, lote, naturaleza, tipo, cantidad,
    project_id, punto_id, usuario_id, fecha, nota, proveedor, documento, area, requiere_revision
  ) values (
    p_material_id, v_ubicacion_movimiento, v_ubicacion_destino, v_lote, v_naturaleza, v_movimiento_tipo, p_cantidad,
    p_project_id, p_punto_id, coalesce(p_tecnico_user_id, auth.uid()), v_fecha, v_nota_efectiva, p_proveedor, p_documento, v_area, v_requiere_revision
  ) returning * into v_row;

  if v_requiere_revision then
    insert into public.eventos_inventario (material_id, ubicacion_id, lote, diferencia, estado, nota, movimiento_id)
    values (p_material_id, v_ubicacion_movimiento, v_lote, -p_cantidad, 'abierto',
      'Instalación forzada en negativo (sin stock suficiente en el proyecto ni el equipo asignado) — proyecto ' || p_project_id::text,
      v_row.id);
  end if;

  return v_row;
end;
$$;


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
