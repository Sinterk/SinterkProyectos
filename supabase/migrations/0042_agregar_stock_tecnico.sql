-- Cuarta forma de resolver un evento de técnico en negativo: "Agregar"
-- (pedido explícito de Andrés Barahona). Racional: si el técnico instaló
-- material que su stock registrado no tenía, es porque ya lo traía consigo
-- de antes sin que quedara contabilizado (no salió de ninguna bodega ni de
-- otro técnico ahora) — se le suma directo, sin restarle a nadie más. A
-- diferencia de Devolución/Reasignación, NO pide origen/técnico destino: es
-- un ajuste de una sola punta.
--
-- Solo aplica a eventos de técnico (mismo dominio que Reasignación) — un
-- evento de bodega (Conteo) no tiene este caso: lo que aparece de más en una
-- bodega ya se resuelve con Devolución/Traspaso.

alter table public.eventos_inventario_resoluciones drop constraint if exists eventos_inventario_resoluciones_tipo_check;
alter table public.eventos_inventario_resoluciones add constraint eventos_inventario_resoluciones_tipo_check
  check (tipo in ('consumo', 'devolucion', 'traspaso', 'reasignacion', 'agregar'));

-- Misma función de 0040_reasignacion_eventos_tecnico.sql, agrega el tipo
-- 'agregar'. Firma idéntica — true replace, sin sobrecarga nueva.
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
  if p_tipo not in ('consumo', 'devolucion', 'traspaso', 'reasignacion', 'agregar') then
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
    raise exception 'Traspaso no aplica a un evento de técnico — el material ya se instaló, usa Devolución, Reasignación o Agregar';
  end if;
  if p_tipo = 'reasignacion' and v_ubicacion_tipo <> 'tecnico' then
    raise exception 'Reasignación solo aplica a eventos de técnico';
  end if;
  if p_tipo = 'agregar' and (v_evento.diferencia >= 0 or v_ubicacion_tipo <> 'tecnico') then
    raise exception 'Agregar solo aplica a eventos de técnico en negativo';
  end if;
  if p_tipo = 'consumo' and p_area is not null and p_area <> 'perdida' and v_evento.movimiento_id is not null then
    raise exception 'Este evento ya tiene un consumo real registrado en un proyecto — usa Reasignación, Agregar o Consumo→Pérdida para no duplicarlo';
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

  elsif p_tipo = 'agregar' then
    -- Una sola punta: se le suma al propio técnico sin restarle a nadie —
    -- ya lo tenía físicamente, no estaba contabilizado en el sistema.
    perform public.adjust_stock(v_evento.ubicacion_id, v_evento.material_id, v_lote, p_cantidad, 0);
    insert into public.movimientos (material_id, ubicacion_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
    values (v_evento.material_id, v_evento.ubicacion_id, v_lote, 'fisico', 'ajuste', p_cantidad, auth.uid(), now(),
      coalesce(p_nota, 'Ajuste — el técnico ya tenía este material sin contabilizar'));
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
