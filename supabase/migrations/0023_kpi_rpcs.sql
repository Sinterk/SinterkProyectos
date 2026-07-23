-- Panel de KPIs: agregación en Postgres (no en el cliente) por volumen —
-- con meses/años de `movimientos` acumulados, traer todo crudo y sumar en
-- el cliente sería lento y, con RLS activa, podría exponer de más. Ambas
-- funciones son SECURITY DEFINER (para poder agregar sobre TODO el histórico
-- sin las restricciones de RLS de un técnico) así que autorizan ellas mismas
-- con is_jp_or_admin() — el panel completo es admin/jp/log únicamente.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Conteo de proyectos (OTT de ATT, o Preventivos/Incidencias de OyM) por
-- periodo: abiertas = se crearon en el rango; cerradas = se cerraron en el
-- rango; pendientes = siguen 'activo' al final del rango (arrastre, con o
-- sin importar cuándo se abrieron).
-- ---------------------------------------------------------------------------
create or replace function public.kpi_proyectos(
  p_area text, p_subarea text, p_desde date, p_hasta date
) returns table(abiertas bigint, cerradas bigint, pendientes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_jp_or_admin() then
    raise exception 'No tienes permiso para ver este panel';
  end if;

  return query
  select
    count(*) filter (where p.created_at::date between p_desde and p_hasta),
    count(*) filter (where p.fecha_cierre between p_desde and p_hasta),
    count(*) filter (where p.estado = 'activo' and p.created_at::date <= p_hasta)
  from public.projects p
  where p.area = p_area
    and p.subarea is not distinct from p_subarea;
end;
$$;

grant execute on function public.kpi_proyectos(text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Consumo de materiales por periodo, una fila por material. Las 6 columnas
-- de flujo (solicitado..merma) suman movimientos CON fecha dentro del rango;
-- "transito" es una foto del saldo acumulado real a `p_hasta` (incluye
-- arrastre de antes del rango, no solo lo que pasó dentro de él) — por eso
-- usa <= p_hasta, sin piso en p_desde. Rezagada (reasignación a preventivo
-- al cerrar un proyecto) queda deliberadamente fuera de "Devuelto": esa
-- reasignación también escribe tipo='traslado', pero hacia la ubicación
-- personal del técnico, no una bodega — se filtra por `ubicaciones.tipo`.
--
-- Un material es "consumible" (se muestra al final de la tabla, sólo con
-- Entregado) si alguno de sus movimientos en el rango salió de la bodega
-- "Consumibles" — mismo criterio ya usado en el resto de la app (no hay
-- columna/flag de categoría en `materiales`, ver PASO 29).
-- ---------------------------------------------------------------------------
-- p_area null = todas las áreas combinadas (vista "solo inventario", sin
-- proyecto de por medio); con área, se scoped a esa (vistas ATT/OyM).
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
      (u.nombre = 'Consumibles') as es_consumible_mov,
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

grant execute on function public.kpi_materiales(text, text, date, date, uuid, uuid[]) to authenticated;
