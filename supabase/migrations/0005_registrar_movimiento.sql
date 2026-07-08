-- Lógica central de inventario como funciones de base de datos (no en el
-- cliente), por dos razones:
-- 1. Atomicidad: cada "registro" toca 1-3 tablas (stock, movimientos,
--    proyecto_materiales); si algo falla a medio camino con llamadas
--    separadas desde el cliente, el inventario queda inconsistente.
-- 2. Permisos: un técnico necesita poder tocar `stock` para Entrega/
--    Instalado/Devuelto, pero la RLS de `stock` solo deja escribir a
--    admin/jp/log. Las funciones son SECURITY DEFINER (corren con más
--    privilegio que quien llama) y autorizan ellas mismas — por eso los
--    helpers internos NO se exponen directo a authenticated/anon, solo las
--    dos funciones de entrada (registrar_movimiento y
--    reasignar_transito_a_preventivo).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Helpers internos (no exponer EXECUTE a authenticated/anon)
-- ---------------------------------------------------------------------------

-- Ajusta stock (delta, no valor absoluto), con bloqueo de fila para evitar
-- carreras entre movimientos concurrentes. Falla si el resultado sería negativo.
create or replace function public.adjust_stock(
  p_ubicacion_id uuid, p_material_id uuid, p_lote text,
  p_delta_fisico numeric default 0, p_delta_digital numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_fisico numeric;
  v_digital numeric;
begin
  select cantidad_fisico, cantidad_digital into v_fisico, v_digital
  from public.stock
  where ubicacion_id = p_ubicacion_id and material_id = p_material_id and lote = p_lote
  for update;

  if v_fisico is null then
    v_fisico := 0;
    v_digital := 0;
  end if;

  if v_fisico + p_delta_fisico < 0 then
    raise exception 'Stock físico insuficiente (hay %, se intentó restar %)', v_fisico, abs(p_delta_fisico);
  end if;
  if v_digital + p_delta_digital < 0 then
    raise exception 'Stock digital insuficiente (hay %, se intentó restar %)', v_digital, abs(p_delta_digital);
  end if;

  insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
  values (p_ubicacion_id, p_material_id, p_lote, greatest(p_delta_fisico, 0), greatest(p_delta_digital, 0))
  on conflict (ubicacion_id, material_id, lote) do update
    set cantidad_fisico = stock.cantidad_fisico + p_delta_fisico,
        cantidad_digital = stock.cantidad_digital + p_delta_digital;
end;
$$;

-- Encuentra o crea la ubicación personal (tipo='tecnico') de un usuario.
create or replace function public.ensure_ubicacion_tecnico(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nombre text;
begin
  select id into v_id from public.ubicaciones where owner_user_id = p_user_id and tipo = 'tecnico' limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(nullif(nombre, ''), email, 'Técnico') into v_nombre
  from public.profiles where id = p_user_id;

  insert into public.ubicaciones (nombre, tipo, owner_user_id)
  values (coalesce(v_nombre, 'Técnico'), 'tecnico', p_user_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Suma `p_delta` al campo cant_* de proyecto_materiales para
-- (proyecto, material, lote, punto) — crea la fila si no existe.
-- p_campo viene siempre de código interno (nunca de input de usuario), así
-- que el uso de format(%I) para el nombre de columna es seguro.
create or replace function public.adjust_proyecto_material(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_campo text, p_delta numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_campo not in ('cant_entregada','cant_instalada','cant_devuelta','cant_rezagada','cant_rebajada') then
    raise exception 'Campo no reconocido: %', p_campo;
  end if;

  if p_punto_id is null then
    execute format(
      'insert into public.proyecto_materiales (project_id, material_id, lote, punto_id, %1$I)
       values ($1, $2, $3, null, $4)
       on conflict (project_id, material_id, lote) where punto_id is null
       do update set %1$I = proyecto_materiales.%1$I + excluded.%1$I',
      p_campo
    ) using p_project_id, p_material_id, p_lote, p_delta;
  else
    execute format(
      'insert into public.proyecto_materiales (project_id, material_id, lote, punto_id, %1$I)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, material_id, lote, punto_id) where punto_id is not null
       do update set %1$I = proyecto_materiales.%1$I + excluded.%1$I',
      p_campo
    ) using p_project_id, p_material_id, p_lote, p_punto_id, p_delta;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entrada pública 1: registrar un movimiento (Entradas/Salidas de la UI)
-- ---------------------------------------------------------------------------
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
  p_tecnico_user_id uuid default null
) returns public.movimientos
language plpgsql security definer set search_path = public as $$
declare
  v_lote text := coalesce(nullif(trim(p_lote), ''), 'SinDefinir');
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_ubicacion_tecnico_id uuid;
  v_movimiento_tipo text;
  v_naturaleza text;
  v_ubicacion_movimiento uuid;
  v_row public.movimientos;
  v_authorized boolean;
begin
  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  -- admin/jp/log siempre pueden. Un técnico solo puede registrar SUS PROPIOS
  -- movimientos (p_tecnico_user_id = quien llama) de un proyecto donde está
  -- asignado (o sin proyecto, para 'entrada' — aunque en la práctica un
  -- técnico normal no hace entradas de bodega).
  v_authorized := public.can_move_inventory();
  if not v_authorized and p_tecnico_user_id is not null and p_tecnico_user_id = auth.uid() then
    v_authorized := (p_project_id is null) or public.is_member(p_project_id);
  end if;
  if not v_authorized then
    raise exception 'No tienes permiso para registrar este movimiento';
  end if;

  if p_tipo_ui = 'entrada' then
    if p_ubicacion_bodega_id is null then
      raise exception 'Falta la bodega de destino';
    end if;
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0);
    v_movimiento_tipo := 'entrada';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  elsif p_tipo_ui = 'solicitud' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Solicitud requiere proyecto y técnico';
    end if;
    v_ubicacion_movimiento := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    v_movimiento_tipo := 'solicitud';
    v_naturaleza := 'fisico';
    -- sin efecto en stock ni proyecto_materiales: solo queda la intención registrada.

  elsif p_tipo_ui = 'entrega' then
    if p_project_id is null or p_tecnico_user_id is null or p_ubicacion_bodega_id is null then
      raise exception 'Entrega requiere proyecto, técnico y bodega de origen';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, p_cantidad, 0);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_entregada', p_cantidad);
    v_movimiento_tipo := 'salida';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := p_ubicacion_bodega_id;

  elsif p_tipo_ui = 'instalado' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Instalado requiere proyecto y técnico';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_instalada', p_cantidad);
    v_movimiento_tipo := 'instalado';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := v_ubicacion_tecnico_id;

  elsif p_tipo_ui = 'devuelto' then
    if p_project_id is null or p_tecnico_user_id is null or p_ubicacion_bodega_id is null then
      raise exception 'Devuelto requiere proyecto, técnico y bodega de destino';
    end if;
    v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_stock(p_ubicacion_bodega_id, p_material_id, v_lote, p_cantidad, 0);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_devuelta', p_cantidad);
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

  insert into public.movimientos (
    material_id, ubicacion_id, lote, naturaleza, tipo, cantidad,
    project_id, punto_id, usuario_id, fecha, nota, proveedor, documento
  ) values (
    p_material_id, v_ubicacion_movimiento, v_lote, v_naturaleza, v_movimiento_tipo, p_cantidad,
    p_project_id, p_punto_id, coalesce(p_tecnico_user_id, auth.uid()), v_fecha, p_nota, p_proveedor, p_documento
  ) returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entrada pública 2: reasignar material "en tránsito" de un proyecto que
-- cierra hacia el stock personal del técnico (queda como "preventivo").
-- ---------------------------------------------------------------------------
create or replace function public.reasignar_transito_a_preventivo(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_tecnico_user_id uuid, p_cantidad numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_lote text := coalesce(nullif(trim(p_lote), ''), 'SinDefinir');
  v_ubicacion_tecnico_id uuid;
  v_authorized boolean;
begin
  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  v_authorized := public.can_move_inventory()
    or (p_tecnico_user_id = auth.uid() and public.is_member(p_project_id));
  if not v_authorized then
    raise exception 'No tienes permiso para esta reasignación';
  end if;

  update public.proyecto_materiales set cant_rezagada = cant_rezagada + p_cantidad
    where project_id = p_project_id and material_id = p_material_id and lote = v_lote
      and punto_id is not distinct from p_punto_id;

  v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
  perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, p_cantidad, 0);

  insert into public.movimientos (
    material_id, ubicacion_id, lote, naturaleza, tipo, cantidad,
    project_id, punto_id, usuario_id, fecha, nota
  ) values (
    p_material_id, v_ubicacion_tecnico_id, v_lote, 'fisico', 'traslado', p_cantidad,
    null, null, p_tecnico_user_id, now(), 'Reasignado a preventivo al cerrar proyecto'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios: solo las 2 funciones de entrada son invocables por clientes.
-- Los helpers quedan sin EXECUTE para authenticated/anon (Postgres los
-- otorga a PUBLIC por defecto al crear la función, así que hay que revocarlo
-- explícitamente).
-- ---------------------------------------------------------------------------
revoke execute on function public.adjust_stock(uuid, uuid, text, numeric, numeric) from public;
revoke execute on function public.ensure_ubicacion_tecnico(uuid) from public;
revoke execute on function public.adjust_proyecto_material(uuid, uuid, text, uuid, text, numeric) from public;

grant execute on function public.registrar_movimiento(
  text, uuid, numeric, text, timestamptz, text, uuid, text, text, uuid, uuid, uuid
) to authenticated;
grant execute on function public.reasignar_transito_a_preventivo(
  uuid, uuid, text, uuid, uuid, numeric
) to authenticated;
