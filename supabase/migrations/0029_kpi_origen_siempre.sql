-- La bodega de origen debe verse siempre en la columna "Origen" del Panel
-- KPI, no solo cuando difiere de la bodega "esperada" de esa tabla — se
-- quita `p_bodega_defecto` (y su exclusión) por completo: casi todas las
-- filas mostraban "—" porque la mayoría de los movimientos SÍ salen de la
-- bodega esperada (C088/C132), que era justo la que se excluía. Con varias
-- bodegas involucradas, sigue mostrando la suma (nombres separados por
-- coma) — eso ya funcionaba bien y no cambia.

drop function if exists public.kpi_materiales(text, text, date, date, uuid[], uuid[], uuid[], uuid[], text);

create or replace function public.kpi_materiales(
  p_area text, p_subarea text, p_desde date, p_hasta date,
  p_ubicacion_ids uuid[] default null,
  p_excluir_ubicacion_ids uuid[] default null,
  p_tecnico_ids uuid[] default null,
  p_stock_ubicacion_ids uuid[] default null
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
      m.material_id as mv_material_id, m.tipo as mv_tipo, m.cantidad as mv_cantidad, m.fecha as mv_fecha,
      u.nombre as mv_ubicacion_nombre, (u.tipo = 'bodega') as mv_es_bodega,
      coalesce(nullif(trim(pr.nombre), ''), pr.email) as mv_tecnico_nombre
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
      mov.mv_material_id as ag_material_id,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'solicitud' and mov.mv_fecha::date between p_desde and p_hasta), 0) as ag_solicitado,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'salida' and mov.mv_fecha::date between p_desde and p_hasta), 0) as ag_entregado,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'instalado' and mov.mv_fecha::date between p_desde and p_hasta), 0) as ag_instalado,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'traslado' and mov.mv_es_bodega and mov.mv_fecha::date between p_desde and p_hasta), 0) as ag_devuelto,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'rebaja' and mov.mv_fecha::date between p_desde and p_hasta), 0) as ag_rebajado,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'merma' and mov.mv_fecha::date between p_desde and p_hasta), 0) as ag_merma,
      coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'salida' and mov.mv_fecha::date <= p_hasta), 0)
        - coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'instalado' and mov.mv_fecha::date <= p_hasta), 0)
        - coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'traslado' and mov.mv_es_bodega and mov.mv_fecha::date <= p_hasta), 0)
        - coalesce(sum(mov.mv_cantidad) filter (where mov.mv_tipo = 'merma' and mov.mv_fecha::date <= p_hasta), 0) as ag_transito,
      nullif(array_to_string(array_agg(distinct mov.mv_ubicacion_nombre) filter (
        where mov.mv_es_bodega and mov.mv_fecha::date between p_desde and p_hasta
      ), ', '), '') as ag_origen_bodega,
      nullif(array_to_string(array_agg(distinct mov.mv_tecnico_nombre) filter (
        where mov.mv_fecha::date between p_desde and p_hasta
      ), ', '), '') as ag_origen_tecnico
    from mov
    group by mov.mv_material_id
  ),
  stock_agg as (
    select s.material_id as sa_material_id, sum(s.cantidad_fisico) as sa_fisico, sum(s.cantidad_digital) as sa_digital
    from public.stock s
    where p_stock_ubicacion_ids is not null and s.ubicacion_id = any(p_stock_ubicacion_ids)
    group by s.material_id
  ),
  materiales_relevantes as (
    select agregado.ag_material_id as mr_material_id from agregado
    union
    select stock_agg.sa_material_id as mr_material_id from stock_agg
  )
  select
    mr.mr_material_id, mat.sku, mat.descripcion,
    coalesce(a.ag_solicitado, 0), coalesce(a.ag_entregado, 0), coalesce(a.ag_instalado, 0), coalesce(a.ag_devuelto, 0),
    coalesce(a.ag_rebajado, 0), coalesce(a.ag_merma, 0), coalesce(a.ag_transito, 0),
    a.ag_origen_bodega, a.ag_origen_tecnico,
    sa.sa_fisico, sa.sa_digital
  from materiales_relevantes mr
  join public.materiales mat on mat.id = mr.mr_material_id
  left join agregado a on a.ag_material_id = mr.mr_material_id
  left join stock_agg sa on sa.sa_material_id = mr.mr_material_id
  where coalesce(a.ag_solicitado, 0) <> 0 or coalesce(a.ag_entregado, 0) <> 0 or coalesce(a.ag_instalado, 0) <> 0
    or coalesce(a.ag_devuelto, 0) <> 0 or coalesce(a.ag_rebajado, 0) <> 0 or coalesce(a.ag_merma, 0) <> 0
    or coalesce(a.ag_transito, 0) <> 0 or coalesce(sa.sa_fisico, 0) <> 0 or coalesce(sa.sa_digital, 0) <> 0
  order by mat.sku;
end;
$$;

grant execute on function public.kpi_materiales(
  text, text, date, date, uuid[], uuid[], uuid[], uuid[]
) to authenticated;
