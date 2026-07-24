-- Renombra la bodega "Consumibles" a "Insumos". Dato + función del Panel KPI
-- actualizados juntos: `kpi_materiales` (0023_kpi_rpcs.sql) identifica estos
-- materiales comparando el nombre exacto de la bodega — si se renombra el
-- dato sin tocar la función, el flag es_consumible deja de detectar nada.

update public.ubicaciones set nombre = 'Insumos' where nombre = 'Consumibles';

-- Misma función de 0023_kpi_rpcs.sql, solo con el nombre de bodega actualizado.
create or replace function public.kpi_materiales(
  p_area text, p_subarea text, p_desde date, p_hasta date,
  p_ubicacion_id uuid default null, p_tecnico_ids uuid[] default null
) returns table(
  material_id uuid, sku text, descripcion text, es_consumible boolean,
  solicitado numeric, entregado numeric, instalado numeric, devuelto numeric,
  rebajado numeric, merma numeric, transito numeric
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
      (u.nombre = 'Insumos') as es_consumible_mov,
      (u.tipo = 'bodega') as es_bodega
    from public.movimientos m
    join public.ubicaciones u on u.id = m.ubicacion_id
    left join public.projects p on p.id = m.project_id
    where (p_area is null or m.area = p_area)
      and (p_subarea is null or p.subarea = p_subarea)
      and (p_ubicacion_id is null or m.ubicacion_id = p_ubicacion_id)
      and (p_tecnico_ids is null or m.usuario_id = any(p_tecnico_ids))
  )
  select
    mat.id, mat.sku, mat.descripcion,
    bool_or(mv.es_consumible_mov),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'solicitud' and mv.fecha::date between p_desde and p_hasta), 0),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'salida' and mv.fecha::date between p_desde and p_hasta), 0),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'instalado' and mv.fecha::date between p_desde and p_hasta), 0),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'traslado' and mv.es_bodega and mv.fecha::date between p_desde and p_hasta), 0),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'rebaja' and mv.fecha::date between p_desde and p_hasta), 0),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'merma' and mv.fecha::date between p_desde and p_hasta), 0),
    coalesce(sum(mv.cantidad) filter (where mv.tipo = 'salida' and mv.fecha::date <= p_hasta), 0)
      - coalesce(sum(mv.cantidad) filter (where mv.tipo = 'instalado' and mv.fecha::date <= p_hasta), 0)
      - coalesce(sum(mv.cantidad) filter (where mv.tipo = 'traslado' and mv.es_bodega and mv.fecha::date <= p_hasta), 0)
      - coalesce(sum(mv.cantidad) filter (where mv.tipo = 'merma' and mv.fecha::date <= p_hasta), 0)
  from mov mv
  join public.materiales mat on mat.id = mv.material_id
  group by mat.id, mat.sku, mat.descripcion
  order by mat.sku;
end;
$$;
