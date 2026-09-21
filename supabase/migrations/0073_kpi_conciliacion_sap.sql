-- KPI nuevo: conciliación de físico vs digital por SKU, pedido de Andrés
-- para tener claridad de cuánto material físico falta para estar cuadrados
-- con SAP. Fórmula validada en detalle antes de escribir esto — ver
-- docs/CONTINUAR-BACKEND.md, sección "Diseño validado (no implementado):
-- KPI Físico vs Digital por SKU" (21-09-2026).
--
-- A diferencia de kpi_materiales (que es por periodo, `desde`/`hasta`),
-- este es un saldo VIVO — no tiene sentido pedirle un rango de fechas,
-- `stock` no tiene historial (mismo motivo documentado en el "Hallazgo
-- técnico importante" del PASO 34).
--
-- Fórmula:
--   fisico_total   = Σ stock.cantidad_fisico en bodegas SAP (p_bodegas_sap_ids) + STK (p_bodega_stk_id)
--                   + Σ stock.cantidad_fisico en ubicaciones tipo 'tecnico'
--                   + Σ proyecto_materiales.cant_instalada de proyectos ATT activos (no cerrados —
--                     al cerrar se asume ya rebajado en SAP, aunque la rebaja real pueda diferir
--                     levemente "para cuadrar", así lo maneja Andrés hoy)
--                   + Σ proyecto_materiales.cant_merma
--   digital_sap    = Σ stock.cantidad_digital en bodegas SAP
--   diferencia_sap = digital_sap - fisico_total (positivo = falta físico; negativo = colchón)
--
--   fisico_stk     = stock.cantidad_fisico en STK (ya incluido en fisico_total también —
--                    STK es inventario físico real, cuenta para ambas preguntas)
--   digital_stk    = stock.cantidad_digital en STK (digital propio de STK, basado en compras
--                    reportadas a Entel — NO es SAP, no se suma con digital_sap: son dos
--                    conciliaciones distintas, mezclarlas puede tapar un descuadre real de una
--                    con un sobrante de la otra)
--   diferencia_stk = digital_stk - fisico_stk
--
-- Las bodegas (SAP y STK) se pasan como parámetro por id, no hardcodeadas
-- acá — mismo patrón que `p_stock_ubicacion_ids` en kpi_materiales — para
-- poder ajustarlas desde la UI durante las pruebas sin otra migración.

create or replace function public.kpi_conciliacion_sap(
  p_bodegas_sap_ids uuid[],
  p_bodega_stk_id uuid
) returns table(
  material_id uuid, sku text, descripcion text,
  fisico_bodegas numeric, fisico_tecnicos numeric, fisico_instalado_att numeric, fisico_merma numeric,
  fisico_total numeric,
  digital_sap numeric, diferencia_sap numeric,
  fisico_stk numeric, digital_stk numeric, diferencia_stk numeric
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_jp_or_admin() then
    raise exception 'No tienes permiso para ver este panel';
  end if;

  return query
  with fb as (
    -- Físico en bodegas SAP + STK (STK cuenta acá también: es físico real).
    select s.material_id as fb_material_id, sum(s.cantidad_fisico) as fb_fisico
    from public.stock s
    where s.ubicacion_id = any(p_bodegas_sap_ids) or s.ubicacion_id = p_bodega_stk_id
    group by s.material_id
  ),
  ds as (
    select s.material_id as ds_material_id, sum(s.cantidad_digital) as ds_digital
    from public.stock s
    where s.ubicacion_id = any(p_bodegas_sap_ids)
    group by s.material_id
  ),
  stk as (
    select s.material_id as stk_material_id,
      sum(s.cantidad_fisico) as stk_fisico, sum(s.cantidad_digital) as stk_digital
    from public.stock s
    where s.ubicacion_id = p_bodega_stk_id
    group by s.material_id
  ),
  ft as (
    select s.material_id as ft_material_id, sum(s.cantidad_fisico) as ft_fisico
    from public.stock s
    join public.ubicaciones u on u.id = s.ubicacion_id
    where u.tipo = 'tecnico'
    group by s.material_id
  ),
  ia as (
    -- 'instalado' de proyectos ATT sin cerrar: ya salió del físico (de
    -- bodega o técnico) pero SAP todavía no se enteró (sin Rebajado) — hay
    -- que sumarlo de vuelta para no mostrar un "falta" espurio.
    select pm.material_id as ia_material_id, sum(pm.cant_instalada) as ia_instalado
    from public.proyecto_materiales pm
    join public.projects p on p.id = pm.project_id
    where p.area = 'ATT' and p.estado = 'activo'
    group by pm.material_id
  ),
  me as (
    -- Merma: salió físico (de técnico) sin bajar nunca el digital — misma
    -- lógica que instalado, se suma de vuelta.
    select pm.material_id as me_material_id, sum(pm.cant_merma) as me_merma
    from public.proyecto_materiales pm
    group by pm.material_id
  ),
  relevantes as (
    select fb_material_id as r_material_id from fb
    union select ds_material_id from ds
    union select stk_material_id from stk
    union select ft_material_id from ft
    union select ia_material_id from ia
    union select me_material_id from me
  )
  select
    r.r_material_id,
    mat.sku, mat.descripcion,
    coalesce(fb.fb_fisico, 0) as fisico_bodegas,
    coalesce(ft.ft_fisico, 0) as fisico_tecnicos,
    coalesce(ia.ia_instalado, 0) as fisico_instalado_att,
    coalesce(me.me_merma, 0) as fisico_merma,
    coalesce(fb.fb_fisico, 0) + coalesce(ft.ft_fisico, 0) + coalesce(ia.ia_instalado, 0) + coalesce(me.me_merma, 0) as fisico_total,
    coalesce(ds.ds_digital, 0) as digital_sap,
    coalesce(ds.ds_digital, 0) - (coalesce(fb.fb_fisico, 0) + coalesce(ft.ft_fisico, 0) + coalesce(ia.ia_instalado, 0) + coalesce(me.me_merma, 0)) as diferencia_sap,
    coalesce(stk.stk_fisico, 0) as fisico_stk,
    coalesce(stk.stk_digital, 0) as digital_stk,
    coalesce(stk.stk_digital, 0) - coalesce(stk.stk_fisico, 0) as diferencia_stk
  from relevantes r
  join public.materiales mat on mat.id = r.r_material_id
  left join fb on fb.fb_material_id = r.r_material_id
  left join ds on ds.ds_material_id = r.r_material_id
  left join stk on stk.stk_material_id = r.r_material_id
  left join ft on ft.ft_material_id = r.r_material_id
  left join ia on ia.ia_material_id = r.r_material_id
  left join me on me.me_material_id = r.r_material_id
  order by mat.sku;
end;
$$;

grant execute on function public.kpi_conciliacion_sap(uuid[], uuid) to authenticated;
