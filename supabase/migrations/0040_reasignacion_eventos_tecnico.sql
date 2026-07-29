-- Completa el diseño de resolución de eventos para el caso de "instalación
-- forzada" (técnico que queda en negativo por instalar sin stock suficiente,
-- ver 0025_prioridad_instalado.sql) — diseño acordado con Andrés Barahona
-- tras revisar que Traspaso/Consumo→proyecto, tal como se diseñaron para
-- eventos de Conteo (bodega), no tienen sentido o duplican datos en este caso:
--
-- 1. **Vínculo directo al movimiento que causó el evento**
--    (`eventos_inventario.movimiento_id`, poblado por `registrar_movimiento`
--    en el mismo insert que ya arma el movimiento) en vez de inferir por
--    fecha/hora — permite saber sin ambigüedad a qué proyecto/técnico/
--    cantidad corresponde la instalación que generó el evento. null para
--    eventos de Conteo (esos no nacen de un solo movimiento).
--
-- 2. **Diferencia clave entre origen bodega y origen técnico**: el stock de
--    una bodega recién contada YA quedó correcto (por eso Devolución/
--    Traspaso de Conteo son "de un solo lado"). El stock de un técnico
--    forzado en negativo NO está correcto — es justo el error a corregir.
--    Por eso, cuando el evento es de un técnico, Devolución pasa a ser "de
--    dos lados": se resta del origen real (bodega o técnico) Y se le
--    devuelve al técnico del evento (subiéndolo hacia 0).
--
-- 3. **Traspaso no aplica a eventos de técnico** — el material ya se instaló
--    de verdad (no está "perdido en otro lado, por encontrar").
--
-- 4. **Consumo→proyecto no aplica si el evento ya tiene movimiento asociado**
--    — ese proyecto ya se acreditó como instalado en el momento de forzar la
--    instalación; repetirlo duplicaría el material en Logística/KPI. Sigue
--    disponible Consumo→Pérdida (sin efecto adicional, igual que antes).
--
-- 5. **Tipo nuevo: REASIGNACIÓN** — mueve el consumo de un técnico a otro que
--    sí tenga el material Y sea parte del mismo proyecto (validado contra
--    `project_members` del proyecto del movimiento original, sin adivinar
--    nada). A diferencia de Devolución, exige stock real en el técnico
--    destino (nunca fuerza negativo) — si no alcanza, el JP debe agregar al
--    técnico correcto al proyecto o resolver por otra vía. No toca
--    `proyecto_materiales` (el total instalado del proyecto ya es correcto,
--    esto solo corrige DE QUIÉN salió físicamente el material).

alter table public.eventos_inventario add column if not exists movimiento_id uuid references public.movimientos(id);

alter table public.eventos_inventario_resoluciones drop constraint if exists eventos_inventario_resoluciones_tipo_check;
alter table public.eventos_inventario_resoluciones add constraint eventos_inventario_resoluciones_tipo_check
  check (tipo in ('consumo', 'devolucion', 'traspaso', 'reasignacion'));

-- Misma función de 0037_traslado_bodega.sql, solo agrega movimiento_id al
-- insert de eventos_inventario (mismo v_row ya insertado arriba). Firma
-- idéntica — true replace, sin sobrecarga nueva.
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
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0);
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
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_stock(p_ubicacion_bodega_destino_id, p_material_id, v_lote, p_cantidad, 0);
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
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, p_cantidad, 0);
    if p_project_id is not null then
      perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_entregada', p_cantidad);
    end if;
    v_movimiento_tipo := 'salida';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  elsif p_tipo_ui = 'instalado' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Instalado requiere proyecto y técnico';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);

    select cantidad_fisico into v_stock_propio from public.stock
      where ubicacion_id = v_ubicacion_tecnico_id and material_id = p_material_id and lote = v_lote;

    if coalesce(v_stock_propio, 0) >= p_cantidad then
      perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
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
        perform public.adjust_stock(v_otra_ubicacion_id, p_material_id, v_lote, -p_cantidad, 0);
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
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_merma', p_cantidad);
    v_movimiento_tipo := 'merma';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := v_ubicacion_tecnico_id;

  elsif p_tipo_ui = 'devuelto' then
    if p_tecnico_user_id is null or p_ubicacion_bodega_id is null then
      raise exception 'Devuelto requiere técnico y bodega de destino';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0);
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
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, 0, -p_cantidad);
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

-- Reemplaza la de 0039_conteo_resolucion_rediseno.sql — misma firma, true
-- replace. Agrega: detección de origen bodega/técnico, Devolución de dos
-- lados para técnico, bloqueo de Traspaso/Consumo→proyecto cuando no
-- corresponde, y el tipo nuevo 'reasignacion'.
create or replace function public.resolver_evento_parcial(
  p_evento_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_area text default null,
  p_project_id uuid default null,
  p_tecnico_user_id uuid default null,
  p_ubicacion_id uuid default null,
  p_nota text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_evento record;
  v_restante numeric;
  v_lote text;
  v_resolucion_id uuid;
  v_ubicacion_tecnico uuid;
  v_area_real text;
  v_ubicacion_tipo text;
  v_tecnico_original uuid;
  v_orig_project_id uuid;
begin
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para resolver este evento';
  end if;
  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;
  if p_tipo not in ('consumo', 'devolucion', 'traspaso', 'reasignacion') then
    raise exception 'Tipo de resolución no reconocido: %', p_tipo;
  end if;

  select id, material_id, ubicacion_id, lote, diferencia, estado, cantidad_resuelta, movimiento_id
    into v_evento
    from public.eventos_inventario where id = p_evento_id for update;
  if v_evento.id is null then
    raise exception 'Evento no encontrado';
  end if;
  if v_evento.estado <> 'abierto' then
    raise exception 'Este evento ya está resuelto por completo';
  end if;

  v_restante := abs(v_evento.diferencia) - v_evento.cantidad_resuelta;
  if p_cantidad > v_restante then
    raise exception 'La cantidad supera lo que falta por resolver (quedan %)', v_restante;
  end if;

  select tipo into v_ubicacion_tipo from public.ubicaciones where id = v_evento.ubicacion_id;
  if v_ubicacion_tipo = 'tecnico' then
    select owner_user_id into v_tecnico_original from public.ubicaciones where id = v_evento.ubicacion_id;
  end if;
  if v_evento.movimiento_id is not null then
    select project_id into v_orig_project_id from public.movimientos where id = v_evento.movimiento_id;
  end if;

  -- Consumo/Traspaso son para faltantes; Devolución para sobrantes — salvo
  -- en un evento de técnico, donde el "sobrante" no existe (siempre queda
  -- negativo) y Devolución igual aplica para corregir de dónde salió.
  if p_tipo in ('consumo', 'traspaso') and v_evento.diferencia >= 0 then
    raise exception 'Consumo/Traspaso solo aplican a faltantes (diferencia negativa)';
  end if;
  if p_tipo = 'devolucion' and v_evento.diferencia <= 0 and v_ubicacion_tipo <> 'tecnico' then
    raise exception 'Devolución solo aplica a sobrantes (diferencia positiva), salvo en eventos de técnico';
  end if;
  if p_tipo = 'reasignacion' and v_evento.diferencia >= 0 then
    raise exception 'Reasignación solo aplica a faltantes (diferencia negativa)';
  end if;
  if p_tipo = 'traspaso' and v_ubicacion_tipo = 'tecnico' then
    raise exception 'Traspaso no aplica a un evento de técnico — el material ya se instaló, usa Devolución o Reasignación';
  end if;
  if p_tipo = 'reasignacion' and v_ubicacion_tipo <> 'tecnico' then
    raise exception 'Reasignación solo aplica a eventos de técnico';
  end if;
  if p_tipo = 'consumo' and p_area is not null and p_area <> 'perdida' and v_evento.movimiento_id is not null then
    raise exception 'Este evento ya tiene un consumo real registrado en un proyecto — usa Reasignación o Consumo→Pérdida para no duplicarlo';
  end if;

  v_lote := v_evento.lote;

  if p_tipo = 'consumo' then
    if p_area is null then
      raise exception 'Consumo requiere elegir un área';
    end if;
    if p_area = 'perdida' then
      null; -- sin efecto adicional: el stock ya refleja lo que corresponde
    else
      if p_project_id is null then
        raise exception 'Consumo hacia % requiere elegir un proyecto', p_area;
      end if;
      select area into v_area_real from public.projects where id = p_project_id;
      if v_area_real is null then
        raise exception 'Proyecto no encontrado';
      end if;
      perform public.adjust_proyecto_material(p_project_id, v_evento.material_id, v_lote, null, 'cant_instalada', p_cantidad);
      if p_tecnico_user_id is not null then
        v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
      end if;
      insert into public.movimientos (
        material_id, ubicacion_id, lote, naturaleza, tipo, cantidad,
        project_id, usuario_id, fecha, nota, area
      ) values (
        v_evento.material_id, coalesce(v_ubicacion_tecnico, v_evento.ubicacion_id), v_lote, 'fisico', 'instalado', p_cantidad,
        p_project_id, coalesce(p_tecnico_user_id, auth.uid()), now(),
        coalesce(p_nota, 'Ajuste por conteo — consumo detectado'), v_area_real
      );
    end if;

  elsif p_tipo = 'devolucion' then
    if (p_tecnico_user_id is not null) = (p_ubicacion_id is not null) then
      raise exception 'Devolución requiere indicar exactamente un origen: técnico o bodega';
    end if;
    if p_tecnico_user_id is not null then
      if p_tecnico_user_id = v_tecnico_original then
        raise exception 'El origen no puede ser el mismo técnico que ya tiene el evento';
      end if;
      v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
      perform public.adjust_stock(v_ubicacion_tecnico, v_evento.material_id, v_lote, -p_cantidad, 0, true);
      insert into public.movimientos (material_id, ubicacion_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
      values (v_evento.material_id, v_evento.ubicacion_id, v_lote, 'fisico', 'traslado', p_cantidad, p_tecnico_user_id, now(),
        coalesce(p_nota, 'Ajuste — devolución no registrada'));
    else
      if p_ubicacion_id = v_evento.ubicacion_id then
        raise exception 'La bodega de origen no puede ser la misma que se está contando';
      end if;
      perform public.adjust_stock(p_ubicacion_id, v_evento.material_id, v_lote, -p_cantidad, 0, true);
      insert into public.movimientos (material_id, ubicacion_id, ubicacion_destino_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
      values (v_evento.material_id, p_ubicacion_id, v_evento.ubicacion_id, v_lote, 'fisico', 'traslado_bodega', p_cantidad, auth.uid(), now(),
        coalesce(p_nota, 'Ajuste — estaba en bodega equivocada'));
    end if;
    -- Dos lados solo si el evento es de un técnico: su negativo no estaba
    -- "ya correcto" (a diferencia de una bodega recién contada), hay que
    -- devolverle lo que le falta.
    if v_ubicacion_tipo = 'tecnico' then
      perform public.adjust_stock(v_evento.ubicacion_id, v_evento.material_id, v_lote, p_cantidad, 0);
    end if;

  elsif p_tipo = 'traspaso' then
    if (p_tecnico_user_id is not null) = (p_ubicacion_id is not null) then
      raise exception 'Traspaso requiere indicar exactamente un destino: técnico o bodega';
    end if;
    if p_ubicacion_id is not null and p_ubicacion_id = v_evento.ubicacion_id then
      raise exception 'La bodega de destino no puede ser la misma que se está contando';
    end if;
    if p_tecnico_user_id is not null then
      v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
      perform public.adjust_stock(v_ubicacion_tecnico, v_evento.material_id, v_lote, p_cantidad, 0);
      insert into public.movimientos (material_id, ubicacion_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
      values (v_evento.material_id, v_evento.ubicacion_id, v_lote, 'fisico', 'salida', p_cantidad, p_tecnico_user_id, now(),
        coalesce(p_nota, 'Ajuste por conteo — encontrado en otro lado'));
    else
      perform public.adjust_stock(p_ubicacion_id, v_evento.material_id, v_lote, p_cantidad, 0);
      insert into public.movimientos (material_id, ubicacion_id, ubicacion_destino_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
      values (v_evento.material_id, v_evento.ubicacion_id, p_ubicacion_id, v_lote, 'fisico', 'traslado_bodega', p_cantidad, auth.uid(), now(),
        coalesce(p_nota, 'Ajuste por conteo — encontrado en otra bodega'));
    end if;

  elsif p_tipo = 'reasignacion' then
    if p_tecnico_user_id is null then
      raise exception 'Reasignación requiere elegir el técnico correcto';
    end if;
    if p_tecnico_user_id = v_tecnico_original then
      raise exception 'El técnico elegido no puede ser el mismo que ya tiene el evento';
    end if;
    if v_orig_project_id is null then
      raise exception 'Este evento no tiene proyecto de origen conocido — no se puede validar';
    end if;
    if not exists (select 1 from public.project_members where project_id = v_orig_project_id and user_id = p_tecnico_user_id) then
      raise exception 'El técnico elegido no está asignado al proyecto de esta instalación — agrégalo primero en Logística';
    end if;
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    -- Débito real: tiene que alcanzarle de verdad, nunca se fuerza negativo acá.
    perform public.adjust_stock(v_ubicacion_tecnico, v_evento.material_id, v_lote, -p_cantidad, 0);
    -- Crédito al técnico que quedó negativo: le arregla su propio número.
    perform public.adjust_stock(v_evento.ubicacion_id, v_evento.material_id, v_lote, p_cantidad, 0);
    insert into public.movimientos (material_id, ubicacion_id, ubicacion_destino_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
    values (v_evento.material_id, v_ubicacion_tecnico, v_evento.ubicacion_id, v_lote, 'fisico', 'traslado_bodega', p_cantidad, auth.uid(), now(),
      coalesce(p_nota, 'Reasignación de consumo al técnico correcto'));
  end if;

  insert into public.eventos_inventario_resoluciones (
    evento_id, tipo, cantidad, area, project_id, tecnico_user_id, ubicacion_id, nota, resuelto_por
  ) values (
    p_evento_id, p_tipo, p_cantidad, p_area, p_project_id, p_tecnico_user_id, p_ubicacion_id, p_nota, auth.uid()
  ) returning id into v_resolucion_id;

  update public.eventos_inventario
  set cantidad_resuelta = cantidad_resuelta + p_cantidad,
      estado = case when cantidad_resuelta + p_cantidad >= abs(diferencia) then 'resuelto' else 'abierto' end,
      resuelto_por = auth.uid(),
      fecha_resolucion = case when cantidad_resuelta + p_cantidad >= abs(diferencia) then now() else fecha_resolucion end
  where id = p_evento_id;
end;
$$;
