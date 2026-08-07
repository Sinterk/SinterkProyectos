-- Al reasignar material a preventivo (botón "→ preventivo" de la columna
-- Tránsito), el movimiento de auditoría que queda tenía `project_id = null`
-- a propósito (el material ya está físicamente con el técnico; reasignar es
-- puro cierre contable del proyecto) — pero eso lo dejaba imposible de
-- rastrear hasta la OTT de la que salió: aparecía como "Sin proyecto" y sin
-- ninguna referencia.
--
-- Ahora se le pone el código en `documento`: "PREVENTIVO - <código>", donde
-- el código es el identificador visible del proyecto (`projects.ott` — es la
-- OTT en ATT, y el código equivalente en Preventivos/Incidencias, que
-- reutilizan esa misma columna). Pedido explícito de Andrés.
--
-- Resto de la función idéntica a 0006_fix_reasignar_transito.sql.
set check_function_bodies = off;

create or replace function public.reasignar_transito_a_preventivo(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_tecnico_user_id uuid, p_cantidad numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_lote text := coalesce(nullif(trim(p_lote), ''), 'SinDefinir');
  v_ubicacion_tecnico_id uuid;
  v_authorized boolean;
  v_codigo text;
begin
  if p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  v_authorized := public.can_move_inventory()
    or (p_tecnico_user_id = auth.uid() and public.is_member(p_project_id));
  if not v_authorized then
    raise exception 'No tienes permiso para esta reasignación';
  end if;

  select ott into v_codigo from public.projects where id = p_project_id;

  update public.proyecto_materiales set cant_rezagada = cant_rezagada + p_cantidad
    where project_id = p_project_id and material_id = p_material_id and lote = v_lote
      and punto_id is not distinct from p_punto_id;

  -- Ubicación del técnico: solo para dejar el registro de auditoría en
  -- movimientos con una ubicacion_id válida (NOT NULL). El material ya
  -- estaba ahí desde la entrega — no se ajusta `stock`.
  v_ubicacion_tecnico_id := public.ensure_ubicacion_tecnico(p_tecnico_user_id);

  insert into public.movimientos (
    material_id, ubicacion_id, lote, naturaleza, tipo, cantidad,
    project_id, punto_id, usuario_id, fecha, nota, documento
  ) values (
    p_material_id, v_ubicacion_tecnico_id, v_lote, 'fisico', 'traslado', p_cantidad,
    null, null, p_tecnico_user_id, now(), 'Reasignado a preventivo al cerrar proyecto',
    'PREVENTIVO - ' || coalesce(v_codigo, 'sin código')
  );
end;
$$;
