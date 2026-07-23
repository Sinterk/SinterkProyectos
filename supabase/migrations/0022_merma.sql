-- Merma: material físico que se desecha (ej. despunte de cable sobrante de
-- una instalación) — no se instala en la red ni vuelve a bodega. Distinto de
-- "Rebajado" (baja contable/digital en SAP, nunca toca stock físico): Merma
-- SÍ es una baja física real, y se comporta como 'instalado' a nivel de
-- stock — sale de la ubicación personal del técnico, sin bodega que elegir.

alter table public.proyecto_materiales add column cant_merma numeric not null default 0;

alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('entrada','salida','ajuste','traslado','rebaja','solicitud','instalado','merma'));

create or replace function public.adjust_proyecto_material(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_campo text, p_delta numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_campo not in ('cant_entregada','cant_instalada','cant_devuelta','cant_rezagada','cant_rebajada','cant_merma') then
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

create or replace function public.corregir_proyecto_material(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_campo text, p_valor numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_campo not in ('cant_entregada', 'cant_instalada', 'cant_devuelta', 'cant_rebajada', 'cant_merma') then
    raise exception 'Campo no reconocido: %', p_campo;
  end if;
  if p_valor < 0 then
    raise exception 'La cantidad no puede ser negativa';
  end if;
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para corregir este valor';
  end if;

  if p_punto_id is null then
    execute format(
      'insert into public.proyecto_materiales (project_id, material_id, lote, punto_id, %1$I)
       values ($1, $2, $3, null, $4)
       on conflict (project_id, material_id, lote) where punto_id is null
       do update set %1$I = excluded.%1$I',
      p_campo
    ) using p_project_id, p_material_id, p_lote, p_valor;
  else
    execute format(
      'insert into public.proyecto_materiales (project_id, material_id, lote, punto_id, %1$I)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, material_id, lote, punto_id) where punto_id is not null
       do update set %1$I = excluded.%1$I',
      p_campo
    ) using p_project_id, p_material_id, p_lote, p_punto_id, p_valor;
  end if;
end;
$$;

-- Misma función de 0020_movimientos_area.sql, + rama 'merma' (mismo patrón
-- que 'instalado': requiere proyecto+técnico, sin bodega, resta del stock
-- físico personal del técnico).
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
    perform public.adjust_stock(v_ubicacion_tecnico_id, p_material_id, v_lote, -p_cantidad, 0);
    perform public.adjust_proyecto_material(p_project_id, p_material_id, v_lote, p_punto_id, 'cant_instalada', p_cantidad);
    v_movimiento_tipo := 'instalado';
    v_naturaleza := 'fisico';
    v_ubicacion_movimiento := v_ubicacion_tecnico_id;

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

  insert into public.movimientos (
    material_id, ubicacion_id, lote, naturaleza, tipo, cantidad,
    project_id, punto_id, usuario_id, fecha, nota, proveedor, documento, area
  ) values (
    p_material_id, v_ubicacion_movimiento, v_lote, v_naturaleza, v_movimiento_tipo, p_cantidad,
    p_project_id, p_punto_id, coalesce(p_tecnico_user_id, auth.uid()), v_fecha, p_nota, p_proveedor, p_documento, v_area
  ) returning * into v_row;

  return v_row;
end;
$$;
