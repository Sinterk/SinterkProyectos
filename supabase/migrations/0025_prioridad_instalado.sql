-- Prioridad de origen del material al marcar algo "Instalado" (en toda la
-- app: el "+" de un punto, la tabla general de Logística, y también ATT):
-- 1. El propio técnico atribuido, si su stock alcanza (comportamiento de
--    siempre).
-- 2. Si no, el compañero de equipo (project_members) del proyecto con más
--    stock del material+lote, si alcanza — se descuenta de su ubicación en
--    vez de la del atribuido.
-- 3. Si nadie del equipo alcanza, se fuerza igual en el técnico atribuido,
--    permitiendo stock negativo, y queda marcado para revisión: se guarda
--    `movimientos.requiere_revision = true` (feedback inmediato en el
--    cliente) y se abre un evento en `eventos_inventario` (mismo flujo de
--    resolución que las discrepancias de conteo, ya con UI en Conteo → Eventos).

alter table public.movimientos add column requiere_revision boolean not null default false;

-- p_permitir_negativo: se salta el chequeo de stock insuficiente — solo lo
-- usa el paso 3 de 'instalado' más abajo, nunca el resto de tipos.
create or replace function public.adjust_stock(
  p_ubicacion_id uuid, p_material_id uuid, p_lote text,
  p_delta_fisico numeric default 0, p_delta_digital numeric default 0,
  p_permitir_negativo boolean default false
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

  if not p_permitir_negativo then
    if v_fisico + p_delta_fisico < 0 then
      raise exception 'Stock físico insuficiente (hay %, se intentó restar %)', v_fisico, abs(p_delta_fisico);
    end if;
    if v_digital + p_delta_digital < 0 then
      raise exception 'Stock digital insuficiente (hay %, se intentó restar %)', v_digital, abs(p_delta_digital);
    end if;
  end if;

  insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
  values (p_ubicacion_id, p_material_id, p_lote, greatest(p_delta_fisico, 0), greatest(p_delta_digital, 0))
  on conflict (ubicacion_id, material_id, lote) do update
    set cantidad_fisico = stock.cantidad_fisico + p_delta_fisico,
        cantidad_digital = stock.cantidad_digital + p_delta_digital;
end;
$$;

-- Misma función de 0022_merma.sql, + rama 'instalado' reescrita con la
-- prioridad de 3 pasos de arriba (el resto de ramas, sin cambios).
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
  p_area text default null
) returns public.movimientos
language plpgsql security definer set search_path = public as $$
declare
  v_lote text := coalesce(nullif(trim(p_lote), ''), 'SinDefinir');
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_ubicacion_tecnico_id uuid;
  v_movimiento_tipo text;
  v_naturaleza text;
  v_ubicacion_movimiento uuid;
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

  elsif p_tipo_ui = 'solicitud' then
    if p_project_id is null or p_tecnico_user_id is null then
      raise exception 'Solicitud requiere proyecto y técnico';
    end if;
    v_ubicacion_movimiento := public.ensure_ubicacion_tecnico(p_tecnico_user_id);
    v_movimiento_tipo := 'solicitud';
    v_naturaleza := 'fisico';

  elsif p_tipo_ui = 'entrega' then
    -- project_id opcional: "Salida preventiva"/consumibles (surtir al técnico sin OTT asociado).
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

    -- Paso 1: el propio técnico atribuido.
    select cantidad_fisico into v_stock_propio from public.stock
      where ubicacion_id = v_ubicacion_tecnico_id and material_id = p_material_id and lote = v_lote;

    if coalesce(v_stock_propio, 0) >= p_cantidad then
      perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
      v_ubicacion_movimiento := v_ubicacion_tecnico_id;
    else
      -- Paso 2: el compañero de equipo con más stock que alcance completo.
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
        -- Paso 3: se fuerza en el atribuido, permitiendo negativo, y se marca para revisión.
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
    -- project_id opcional: devolver excedente preventivo sin OTT asociado.
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
    material_id, ubicacion_id, lote, naturaleza, tipo, cantidad,
    project_id, punto_id, usuario_id, fecha, nota, proveedor, documento, area, requiere_revision
  ) values (
    p_material_id, v_ubicacion_movimiento, v_lote, v_naturaleza, v_movimiento_tipo, p_cantidad,
    p_project_id, p_punto_id, coalesce(p_tecnico_user_id, auth.uid()), v_fecha, v_nota_efectiva, p_proveedor, p_documento, v_area, v_requiere_revision
  ) returning * into v_row;

  if v_requiere_revision then
    insert into public.eventos_inventario (material_id, ubicacion_id, lote, diferencia, estado, nota)
    values (p_material_id, v_ubicacion_movimiento, v_lote, -p_cantidad, 'abierto',
      'Instalación forzada en negativo (sin stock suficiente en el proyecto ni el equipo asignado) — proyecto ' || p_project_id::text);
  end if;

  return v_row;
end;
$$;
