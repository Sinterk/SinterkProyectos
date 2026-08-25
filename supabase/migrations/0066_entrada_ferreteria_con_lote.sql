-- Andrés: "aunque sea ferretería se debe poder registrar el lote, puesto
-- que el material está asociado a un lote en SAP. Se debe poder ingresar un
-- lote, aunque sea ferretería, para que calce el inventario interno con el
-- de SAP. Que se grabe en stock físico como físico, que se grabe en stock
-- digital bajo el lote indicado."
--
-- Hasta acá (0064/0065) Ferretería en un movimiento FÍSICO nunca pedía
-- lote: el cliente ocultaba el selector y mandaba siempre 'Físico'. Eso
-- seguía siendo correcto para Entrega/Devuelto/Instalado/Merma (consumen
-- del montón físico indistinguible), pero para ENTRADA se queda corto: el
-- material llega con un lote real de SAP, y hoy no había forma de dejarlo
-- registrado.
--
-- Cambio, solo en 'entrada' (registrar/corregir/anular), y solo cuando el
-- material es Ferretería:
--   * El físico SIEMPRE se acredita en el lote fijo 'Físico' (nunca en el
--     lote que se haya tipeado) — el físico de Ferretería sigue sin
--     distinguir lote, eso no cambia.
--   * Si además se indicó un lote real (no vacío/'SinDefinir', no
--     'Físico'), ESE MISMO movimiento también acredita `cantidad_digital`
--     bajo ese lote — así el inventario digital calza con SAP desde el
--     ingreso, sin esperar a una Rebaja para recién enterarse de qué lote
--     es. La fila de `movimientos` guarda ese lote real (no 'Físico'), que
--     es lo que tiene sentido ver/editar en pantalla.
--
-- Para materiales que NO son Ferretería no cambia nada: un solo
-- `adjust_stock` físico bajo el lote indicado, como siempre.
--
-- IMPORTANTE — orden de migraciones: esto asume que 0065 (traspaso
-- retroactivo a lote 'Físico') ya corrió. `corregir_movimiento` y
-- `anular_movimiento` deciden si un movimiento viejo fue "con lote real"
-- mirando si `movimientos.lote` guardado no es 'SinDefinir' ni 'Físico' —
-- eso solo es confiable para movimientos físicos de Ferretería si ya están
-- normalizados a 'Físico' por 0065. Si 0065 todavía no corrió en este
-- ambiente, correrla primero.
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
  v_es_ferreteria boolean;
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

    select coalesce(lower(trim(mt.nombre)) = 'ferretería', false) into v_es_ferreteria
      from public.materiales m left join public.material_tipos mt on mt.id = m.tipo_id
      where m.id = p_material_id;

    if v_es_ferreteria then
      perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, 'Físico', p_cantidad, 0, true);
      if v_lote not in ('SinDefinir', 'Físico') then
        perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, 0, p_cantidad, true);
      end if;
    else
      perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0, true);
    end if;
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

-- Corrige una entrada ya registrada: si el material es Ferretería, revierte
-- el estado viejo (físico en 'Físico' + digital en el lote viejo, si había)
-- y aplica el nuevo con el mismo criterio — mismo cambio que en
-- registrar_movimiento, ver el comentario de arriba.
create or replace function public.corregir_movimiento(
  p_movimiento_id uuid,
  p_lote text default null,
  p_cantidad numeric default null,
  p_nota text default null
) returns public.movimientos
language plpgsql security definer set search_path = public as $$
declare
  v_mov public.movimientos;
  v_lote_nuevo text;
  v_cant_nueva numeric;
  v_ubicacion_tecnico uuid;
  v_es_ferreteria boolean;
begin
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para corregir movimientos';
  end if;

  select * into v_mov from public.movimientos where id = p_movimiento_id for update;
  if v_mov.id is null then
    raise exception 'Movimiento no encontrado';
  end if;

  -- null = "no tocar este campo". El lote vacío se normaliza igual que en
  -- `registrar_movimiento`, para que 'SinDefinir' sea siempre el mismo texto.
  v_lote_nuevo := coalesce(nullif(trim(p_lote), ''), v_mov.lote);
  v_cant_nueva := coalesce(p_cantidad, v_mov.cantidad);

  if v_cant_nueva <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  if v_mov.evento_resolucion_id is not null then
    raise exception 'Este movimiento es la resolución de un evento de conteo — no se corrige desde acá';
  end if;
  if exists (select 1 from public.eventos_inventario where movimiento_id = p_movimiento_id) then
    raise exception 'Este movimiento generó un evento de revisión — resuélvelo o anúlalo, no se corrige en el lugar';
  end if;

  if v_mov.tipo = 'traslado' and (
    v_mov.documento like 'PREVENTIVO - %' or v_mov.nota = 'Reasignado a preventivo al cerrar proyecto'
  ) then
    raise exception 'Las reasignaciones a preventivo se corrigen en "Asignado a técnico", en la tabla del proyecto';
  end if;

  if v_mov.tipo not in ('entrada', 'salida', 'traslado', 'ajuste') then
    raise exception 'No se pueden corregir movimientos de tipo % desde Registro', v_mov.tipo;
  end if;

  -- Cambió solo la nota: no hay stock que rehacer.
  if v_lote_nuevo = v_mov.lote and v_cant_nueva = v_mov.cantidad then
    update public.movimientos
       set nota = case when p_nota is null then nota else nullif(trim(p_nota), '') end
     where id = p_movimiento_id
     returning * into v_mov;
    return v_mov;
  end if;

  if v_mov.tipo = 'entrada' then
    select coalesce(lower(trim(mt.nombre)) = 'ferretería', false) into v_es_ferreteria
      from public.materiales m left join public.material_tipos mt on mt.id = m.tipo_id
      where m.id = v_mov.material_id;

    if v_es_ferreteria then
      perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, 'Físico', -v_mov.cantidad, 0, true);
      if v_mov.lote not in ('SinDefinir', 'Físico') then
        perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, 0, -v_mov.cantidad, true);
      end if;
      perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, 'Físico', v_cant_nueva, 0, true);
      if v_lote_nuevo not in ('SinDefinir', 'Físico') then
        perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, 0, v_cant_nueva, true);
      end if;
    else
      perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
      perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
    end if;

  elsif v_mov.tipo = 'salida' then -- Entrega: bodega -> técnico
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, -v_cant_nueva, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_entregada', -v_mov.cantidad);
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_lote_nuevo, v_mov.punto_id, 'cant_entregada', v_cant_nueva);
    end if;

  elsif v_mov.tipo = 'traslado' then -- Devolución: técnico -> bodega
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_lote_nuevo, -v_cant_nueva, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_devuelta', -v_mov.cantidad);
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_lote_nuevo, v_mov.punto_id, 'cant_devuelta', v_cant_nueva);
    end if;

  elsif v_mov.tipo = 'ajuste' then -- Conteo: crédito al técnico
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
  end if;

  update public.movimientos
     set lote     = v_lote_nuevo,
         cantidad = v_cant_nueva,
         nota     = case when p_nota is null then nota else nullif(trim(p_nota), '') end
   where id = p_movimiento_id
   returning * into v_mov;

  return v_mov;
end;
$$;

-- Anular una entrada de Ferretería con lote real revierte los dos lados
-- (físico en 'Físico', digital en el lote guardado) — mismo criterio que
-- arriba. El resto del cuerpo es idéntico al de 0058 (el único cambio real
-- es la rama 'entrada'): no se toca el borrado previo de eventos_inventario
-- ni la reasignación a preventivo, ambos siguen igual.
create or replace function public.anular_movimiento(p_movimiento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mov public.movimientos;
  v_ubicacion_tecnico uuid;
  v_codigo_preventivo text;
  v_project_reasignado uuid;
  v_es_ferreteria boolean;
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
  -- Antes del delete del movimiento: `eventos_inventario.movimiento_id` es una
  -- FK sin cascade (ver 0040), así que dejarlo apuntando a una fila borrada
  -- reventaría con 23503. Si el evento tenía resoluciones, se van con él
  -- (`eventos_inventario_resoluciones.evento_id` sí tiene cascade, ver 0039):
  -- son bookkeeping DEL EVENTO, y el efecto real de cada resolución quedó en
  -- su propio movimiento, que sigue en la tabla y se anula por separado.
  delete from public.eventos_inventario where movimiento_id = p_movimiento_id;
  if v_mov.evento_resolucion_id is not null then
    raise exception 'Este movimiento es la resolución de un evento de conteo — no se puede anular directo';
  end if;

  if v_mov.tipo = 'entrada' then
    select coalesce(lower(trim(mt.nombre)) = 'ferretería', false) into v_es_ferreteria
      from public.materiales m left join public.material_tipos mt on mt.id = m.tipo_id
      where m.id = v_mov.material_id;

    if v_es_ferreteria then
      perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, 'Físico', -v_mov.cantidad, 0, true);
      if v_mov.lote not in ('SinDefinir', 'Físico') then
        perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, 0, -v_mov.cantidad, true);
      end if;
    else
      perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    end if;

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
