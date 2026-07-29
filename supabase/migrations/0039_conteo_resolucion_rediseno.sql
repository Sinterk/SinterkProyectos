-- Rediseño de cómo se resuelve una diferencia de Conteo (pedido explícito de
-- Andrés Barahona). El modelo viejo (resolver_evento_inventario con 3
-- etiquetas fijas: devolucion_pendiente/reubicacion/perdida) era solo un
-- registro de "por qué" — el stock ya había quedado ajustado al cerrar el
-- conteo (cerrar_conteo) y la resolución no tocaba nada más. El nuevo modelo:
--
-- 1. Un evento se puede resolver EN VARIAS PARTES (parcial): de una
--    diferencia de 10, se puede resolver 6 ahora y dejar 4 pendientes para
--    después. Por eso se separa la resolución a una tabla hija
--    (eventos_inventario_resoluciones), y el evento acumula
--    `cantidad_resuelta` — pasa a 'resuelto' recién cuando cantidad_resuelta
--    alcanza el total de la diferencia (en valor absoluto).
--
-- 2. Tres formas de resolver, cada una con su propio efecto real (a
--    diferencia del modelo viejo, que no tocaba nada):
--    - CONSUMO (para faltantes): el material se dio de baja de verdad.
--      Si el área elegida es 'perdida', es solo eso — igual que el
--      "perdida" de antes, sin efecto adicional (el stock ya quedó
--      correcto al cerrar el conteo). Si el área es 'ott'/'inc'/
--      'preventivos', se exige un proyecto — se suma a
--      `proyecto_materiales.cant_instalada` de ese proyecto (para que
--      aparezca en su tabla de Logística) y se inserta un `movimientos`
--      con tipo='instalado' (para que aparezca en el Panel de KPI) — SIN
--      tocar stock de nuevo (el stock del conteo ya está correcto; si se
--      indica técnico, la fila queda a su nombre, si no, a nombre de la
--      propia bodega contada).
--    - DEVOLUCIÓN (para sobrantes — apareció más de lo esperado): se
--      indica un origen (un técnico que todavía lo tiene registrado, o
--      una bodega donde quedó mal contado) y se le RESTA esa cantidad a
--      ese origen — el conteo ya sumó esta cantidad acá, así que no hay
--      que sumarla de nuevo, solo corregir de dónde salió.
--    - TRASPASO (para faltantes, alternativa a Consumo — el material no
--      se perdió, está en otro lado): se indica un destino (bodega o
--      técnico) y se le SUMA esa cantidad ahí — sin volver a restarle
--      nada a la bodega del conteo (ya quedó correcta al cerrarlo).
--
-- Se elimina resolver_evento_inventario (reemplazada por
-- resolver_evento_parcial) — nada la sigue llamando. La columna
-- `resolucion`/el check viejo de eventos_inventario quedan intactos (dato
-- histórico inerte de eventos ya resueltos con el modelo anterior).

alter table public.eventos_inventario add column if not exists cantidad_resuelta numeric not null default 0;

create table public.eventos_inventario_resoluciones (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos_inventario(id) on delete cascade,
  tipo            text not null check (tipo in ('consumo', 'devolucion', 'traspaso')),
  cantidad        numeric not null check (cantidad > 0),
  -- Solo 'consumo': categoría elegida en el selector "Área". 'perdida' no
  -- lleva proyecto; las otras tres sí (filtran qué proyectos mostrar en el
  -- selector, pero el área real que se guarda en `movimientos` sale del
  -- proyecto elegido, no de este valor).
  area            text check (area in ('ott', 'inc', 'preventivos', 'perdida')),
  project_id      uuid references public.projects(id),
  -- Devolución: origen. Traspaso: destino. Exactamente uno de los dos
  -- (tecnico_user_id, ubicacion_id) — se valida en la función, no acá,
  -- porque además depende del tipo.
  tecnico_user_id uuid references public.profiles(id),
  ubicacion_id    uuid references public.ubicaciones(id),
  nota            text,
  resuelto_por    uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index on public.eventos_inventario_resoluciones (evento_id);

alter table public.movimientos add column if not exists evento_resolucion_id uuid references public.eventos_inventario_resoluciones(id);

alter table public.eventos_inventario_resoluciones enable row level security;
create policy eir_read  on public.eventos_inventario_resoluciones for select using (auth.uid() is not null);
create policy eir_write on public.eventos_inventario_resoluciones for all using (public.can_move_inventory()) with check (public.can_move_inventory());

grant select, insert, update, delete on public.eventos_inventario_resoluciones to authenticated, service_role;

drop function if exists public.resolver_evento_inventario(uuid, text, text);

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
begin
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para resolver este evento';
  end if;
  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;
  if p_tipo not in ('consumo', 'devolucion', 'traspaso') then
    raise exception 'Tipo de resolución no reconocido: %', p_tipo;
  end if;

  select id, material_id, ubicacion_id, lote, diferencia, estado, cantidad_resuelta
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

  -- Consumo/Traspaso son para faltantes (diferencia < 0, contado < sistema);
  -- Devolución es para sobrantes (diferencia > 0) — no tiene sentido cruzarlos.
  if p_tipo in ('consumo', 'traspaso') and v_evento.diferencia >= 0 then
    raise exception 'Consumo/Traspaso solo aplican a faltantes (diferencia negativa)';
  end if;
  if p_tipo = 'devolucion' and v_evento.diferencia <= 0 then
    raise exception 'Devolución solo aplica a sobrantes (diferencia positiva)';
  end if;

  v_lote := v_evento.lote;

  if p_tipo = 'consumo' then
    if p_area is null then
      raise exception 'Consumo requiere elegir un área';
    end if;
    if p_area = 'perdida' then
      -- Sin efecto adicional: el stock ya quedó correcto al cerrar el conteo.
      null;
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
    if p_ubicacion_id is not null and p_ubicacion_id = v_evento.ubicacion_id then
      raise exception 'La bodega de origen no puede ser la misma que se está contando';
    end if;
    if p_tecnico_user_id is not null then
      v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
      perform public.adjust_stock(v_ubicacion_tecnico, v_evento.material_id, v_lote, -p_cantidad, 0, true);
      insert into public.movimientos (material_id, ubicacion_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
      values (v_evento.material_id, v_evento.ubicacion_id, v_lote, 'fisico', 'traslado', p_cantidad, p_tecnico_user_id, now(),
        coalesce(p_nota, 'Ajuste por conteo — devolución no registrada'));
    else
      perform public.adjust_stock(p_ubicacion_id, v_evento.material_id, v_lote, -p_cantidad, 0, true);
      insert into public.movimientos (material_id, ubicacion_id, ubicacion_destino_id, lote, naturaleza, tipo, cantidad, usuario_id, fecha, nota)
      values (v_evento.material_id, p_ubicacion_id, v_evento.ubicacion_id, v_lote, 'fisico', 'traslado_bodega', p_cantidad, auth.uid(), now(),
        coalesce(p_nota, 'Ajuste por conteo — estaba en bodega equivocada'));
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

grant execute on function public.resolver_evento_parcial(uuid, text, numeric, text, uuid, uuid, uuid, text) to authenticated;
