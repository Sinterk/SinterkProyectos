-- Rediseño del Panel de KPIs (rondas de ajuste tras el primer uso real):
-- 1) tabla de detalle de proyectos (no solo 3 números), 2) bug real donde
-- un mes sin actividad igual mostraba los mismos SKU, 3) fusión de
-- "Material por proyecto"/"Inventario (bodega)" en una sola tabla con
-- columnas de Origen/Físico/Digital, 4) Inventario por bodega (multi-select)
-- o por técnico como modos excluyentes.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- kpi_proyectos → kpi_proyectos_detalle: una fila por proyecto relevante al
-- periodo, con su estado calculado (mutuamente excluyente, en ese orden de
-- prioridad): 'cerrado' si se cerró dentro del rango (aunque se haya abierto
-- antes); si no, 'abierto' si se creó dentro del rango; si no, 'pendiente'
-- si se creó antes del rango y sigue sin cerrarse dentro de él. Los 3
-- números del resumen del panel se cuentan en el cliente desde estas mismas
-- filas — una sola definición de "abierto/cerrado/pendiente", no dos.
-- ---------------------------------------------------------------------------
drop function if exists public.kpi_proyectos(text, text, date, date);

create or replace function public.kpi_proyectos_detalle(
  p_area text, p_subarea text, p_desde date, p_hasta date
) returns table(project_id uuid, ott text, estado text, fecha_inicio date)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_jp_or_admin() then
    raise exception 'No tienes permiso para ver este panel';
  end if;

  return query
  with clasificado as (
    select p.id, p.ott, p.created_at::date as fecha_inicio,
      case
        when p.fecha_cierre between p_desde and p_hasta then 'cerrado'
        when p.created_at::date between p_desde and p_hasta then 'abierto'
        when p.created_at::date < p_desde and (p.fecha_cierre is null or p.fecha_cierre > p_hasta) then 'pendiente'
      end as estado
    from public.projects p
    where p.area = p_area
      and p.subarea is not distinct from p_subarea
  )
  select id, ott, estado, fecha_inicio
  from clasificado
  where estado is not null
  order by
    case estado when 'abierto' then 0 when 'pendiente' then 1 when 'cerrado' then 2 end,
    fecha_inicio asc;
end;
$$;

grant execute on function public.kpi_proyectos_detalle(text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- kpi_materiales: reescrita completa (cambia el tipo de p_ubicacion_id, así
-- que se dropea la firma vieja en vez de vivir junto a ella como overload).
--
-- Bug arreglado: antes el CTE de movimientos no filtraba por fecha, así que
-- CUALQUIER material con historial (de cualquier época) aparecía con ceros
-- en un mes sin actividad. Ahora se arma la lista de materiales relevantes
-- como la UNIÓN de "tuvo algún movimiento" y "tiene stock pedido" — nunca
-- todos los materiales del catálogo — y al final se descartan las filas
-- donde absolutamente todo (flujo, tránsito, físico, digital) da 0/null.
--
-- Nuevo: p_excluir_ubicacion_ids (para sacar Insumos de las tablas "por
-- proyecto", que tienen su propia tabla aparte); p_stock_ubicacion_ids
-- (Físico/Digital de esas bodegas — el cliente solo lo manda si el periodo
-- termina hoy, ver KpiScreen.tsx: no hay forma de reconstruir el saldo
-- exacto de una fecha pasada con el esquema actual, `stock` es un saldo
-- vivo); p_bodega_defecto (nombre de la bodega "esperada" de esa tabla,
-- p.ej. 'C088' — se excluye de origen_bodega, que así solo lista bodegas
-- fuera de lo esperado).
-- ---------------------------------------------------------------------------
drop function if exists public.kpi_materiales(text, text, date, date, uuid, uuid[]);

create or replace function public.kpi_materiales(
  p_area text, p_subarea text, p_desde date, p_hasta date,
  p_ubicacion_ids uuid[] default null,
  p_excluir_ubicacion_ids uuid[] default null,
  p_tecnico_ids uuid[] default null,
  p_stock_ubicacion_ids uuid[] default null,
  p_bodega_defecto text default null
) returns table(
  material_id uuid, sku text, descripcion text,
  solicitado numeric, entregado numeric, instalado numeric, devuelto numeric,
  rebajado numeric, merma numeric, transito numeric,
  origen_bodega text, origen_tecnico text,
  fisico numeric, digital numeric
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_jp_or_admin() then
    raise exception 'No tienes permiso para ver este panel';
  end if;

  return query
  with mov as (
    select
      m.material_id, m.tipo, m.cantidad, m.fecha,
      u.nombre as ubicacion_nombre, (u.tipo = 'bodega') as es_bodega,
      coalesce(nullif(trim(pr.nombre), ''), pr.email) as tecnico_nombre
    from public.movimientos m
    join public.ubicaciones u on u.id = m.ubicacion_id
    left join public.projects p on p.id = m.project_id
    left join public.profiles pr on pr.id = m.usuario_id
    where (p_area is null or m.area = p_area)
      and (p_subarea is null or p.subarea = p_subarea)
      and (p_ubicacion_ids is null or m.ubicacion_id = any(p_ubicacion_ids))
      and (p_excluir_ubicacion_ids is null or m.ubicacion_id <> all(p_excluir_ubicacion_ids))
      and (p_tecnico_ids is null or m.usuario_id = any(p_tecnico_ids))
  ),
  agregado as (
    select
      mv.material_id,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'solicitud' and mv.fecha::date between p_desde and p_hasta), 0) as solicitado,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'salida' and mv.fecha::date between p_desde and p_hasta), 0) as entregado,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'instalado' and mv.fecha::date between p_desde and p_hasta), 0) as instalado,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'traslado' and mv.es_bodega and mv.fecha::date between p_desde and p_hasta), 0) as devuelto,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'rebaja' and mv.fecha::date between p_desde and p_hasta), 0) as rebajado,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'merma' and mv.fecha::date between p_desde and p_hasta), 0) as merma,
      coalesce(sum(mv.cantidad) filter (where mv.tipo = 'salida' and mv.fecha::date <= p_hasta), 0)
        - coalesce(sum(mv.cantidad) filter (where mv.tipo = 'instalado' and mv.fecha::date <= p_hasta), 0)
        - coalesce(sum(mv.cantidad) filter (where mv.tipo = 'traslado' and mv.es_bodega and mv.fecha::date <= p_hasta), 0)
        - coalesce(sum(mv.cantidad) filter (where mv.tipo = 'merma' and mv.fecha::date <= p_hasta), 0) as transito,
      nullif(array_to_string(array_agg(distinct mv.ubicacion_nombre) filter (
        where mv.es_bodega and mv.fecha::date between p_desde and p_hasta
          and (p_bodega_defecto is null or mv.ubicacion_nombre <> p_bodega_defecto)
      ), ', '), '') as origen_bodega,
      nullif(array_to_string(array_agg(distinct mv.tecnico_nombre) filter (
        where mv.fecha::date between p_desde and p_hasta
      ), ', '), '') as origen_tecnico
    from mov mv
    group by mv.material_id
  ),
  stock_agg as (
    select s.material_id, sum(s.cantidad_fisico) as fisico, sum(s.cantidad_digital) as digital
    from public.stock s
    where p_stock_ubicacion_ids is not null and s.ubicacion_id = any(p_stock_ubicacion_ids)
    group by s.material_id
  ),
  materiales_relevantes as (
    select material_id from agregado
    union
    select material_id from stock_agg
  )
  select
    mr.material_id, mat.sku, mat.descripcion,
    coalesce(a.solicitado, 0), coalesce(a.entregado, 0), coalesce(a.instalado, 0), coalesce(a.devuelto, 0),
    coalesce(a.rebajado, 0), coalesce(a.merma, 0), coalesce(a.transito, 0),
    a.origen_bodega, a.origen_tecnico,
    sa.fisico, sa.digital
  from materiales_relevantes mr
  join public.materiales mat on mat.id = mr.material_id
  left join agregado a on a.material_id = mr.material_id
  left join stock_agg sa on sa.material_id = mr.material_id
  where coalesce(a.solicitado, 0) <> 0 or coalesce(a.entregado, 0) <> 0 or coalesce(a.instalado, 0) <> 0
    or coalesce(a.devuelto, 0) <> 0 or coalesce(a.rebajado, 0) <> 0 or coalesce(a.merma, 0) <> 0
    or coalesce(a.transito, 0) <> 0 or coalesce(sa.fisico, 0) <> 0 or coalesce(sa.digital, 0) <> 0
  order by mat.sku;
end;
$$;

grant execute on function public.kpi_materiales(
  text, text, date, date, uuid[], uuid[], uuid[], uuid[], text
) to authenticated;
