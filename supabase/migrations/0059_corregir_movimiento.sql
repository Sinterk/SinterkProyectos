-- Corregir un movimiento ya registrado sin borrarlo ni perder su fecha.
--
-- El caso que lo motiva (Andrés, 11-08-2026): no hay SAP, y el lote real de
-- lo que entra muchas veces se sabe DESPUÉS, cuando Entel actualiza su
-- stock. Hasta ahora la única salida era anular el movimiento y volver a
-- registrarlo, lo que le cambia la fecha y rompe la trazabilidad de cuándo
-- ocurrió de verdad la entrega/entrada. `registrar_movimiento` ya contempla
-- registrar sin lote (queda en 'SinDefinir'); faltaba el paso de completarlo.
--
-- Qué hace: revierte el efecto de stock del movimiento tal como está
-- guardado, aplica el efecto con los valores nuevos, y recién ahí actualiza
-- la fila. Nunca un UPDATE crudo del lote/cantidad — eso dejaría el stock
-- apuntando al lote viejo y descuadraría la bodega en silencio. Es el mismo
-- principio de `anular_movimiento` (0048), pero terminando en update en vez
-- de delete.
--
-- ALCANCE — solo los cuatro tipos que se registran desde
-- Inventario → Registro, que es donde vive la UI que llama a esto:
--
--   entrada   Entrada             bodega +
--   salida    Entrega             bodega −, técnico +
--   traslado  Devolución          técnico −, bodega +
--   ajuste    Conteo              técnico +
--
-- Deliberadamente NO se aceptan:
--   * `instalado` — su registro tiene una cadena de fallback (stock propio →
--     otro miembro del proyecto → forzado en negativo abriendo un evento de
--     revisión, ver 0025). Reaplicarla acá podría abrir eventos nuevos por
--     una simple corrección de tipeo. Se corrige desde la tabla del proyecto.
--   * `merma`, `rebaja`, `solicitud`, `traslado_bodega` — no aparecen en
--     estas listas; se anulan y se vuelven a registrar.
--   * la reasignación a preventivo, que comparte el tipo 'traslado' con
--     Devolución pero no mueve stock (ver 0058): se corrige en la celda
--     "Asignado a técnico" de la tabla del proyecto (0052).
--
-- Los `adjust_stock` van todos con `p_permitir_negativo => true`: una
-- corrección tiene que poder ejecutarse aunque el saldo intermedio quede
-- negativo, igual que en 0055 — si no, corregir un error queda bloqueado
-- justamente por el error que se está corrigiendo.
create or replace function public.corregir_movimiento(
  p_movimiento_id uuid,
  p_lote text default null,
  p_cantidad numeric default null,
  p_nota text default null
) returns public.movimientos
language plpgsql security definer set search_path = public as $$
declare
  v_mov public.movimientos;
  v_lote_nuevo text;
  v_cant_nueva numeric;
  v_ubicacion_tecnico uuid;
begin
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para corregir movimientos';
  end if;

  select * into v_mov from public.movimientos where id = p_movimiento_id for update;
  if v_mov.id is null then
    raise exception 'Movimiento no encontrado';
  end if;

  -- null = "no tocar este campo". El lote vacío se normaliza igual que en
  -- `registrar_movimiento`, para que 'SinDefinir' sea siempre el mismo texto.
  v_lote_nuevo := coalesce(nullif(trim(p_lote), ''), v_mov.lote);
  v_cant_nueva := coalesce(p_cantidad, v_mov.cantidad);

  if v_cant_nueva <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  if v_mov.evento_resolucion_id is not null then
    raise exception 'Este movimiento es la resolución de un evento de conteo — no se corrige desde acá';
  end if;
  if exists (select 1 from public.eventos_inventario where movimiento_id = p_movimiento_id) then
    raise exception 'Este movimiento generó un evento de revisión — resuélvelo o anúlalo, no se corrige en el lugar';
  end if;

  if v_mov.tipo = 'traslado' and (
    v_mov.documento like 'PREVENTIVO - %' or v_mov.nota = 'Reasignado a preventivo al cerrar proyecto'
  ) then
    raise exception 'Las reasignaciones a preventivo se corrigen en "Asignado a técnico", en la tabla del proyecto';
  end if;

  if v_mov.tipo not in ('entrada', 'salida', 'traslado', 'ajuste') then
    raise exception 'No se pueden corregir movimientos de tipo % desde Registro', v_mov.tipo;
  end if;

  -- Cambió solo la nota: no hay stock que rehacer.
  if v_lote_nuevo = v_mov.lote and v_cant_nueva = v_mov.cantidad then
    update public.movimientos
       set nota = case when p_nota is null then nota else nullif(trim(p_nota), '') end
     where id = p_movimiento_id
     returning * into v_mov;
    return v_mov;
  end if;

  if v_mov.tipo = 'entrada' then
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);

  elsif v_mov.tipo = 'salida' then -- Entrega: bodega -> técnico
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, -v_cant_nueva, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_entregada', -v_mov.cantidad);
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_lote_nuevo, v_mov.punto_id, 'cant_entregada', v_cant_nueva);
    end if;

  elsif v_mov.tipo = 'traslado' then -- Devolución: técnico -> bodega
    v_ubicacion_tecnico := public.ensure_ubicacion_tecnico(v_mov.usuario_id);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_mov.lote, v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
    perform public.adjust_stock(v_ubicacion_tecnico, v_mov.material_id, v_lote_nuevo, -v_cant_nueva, 0, true);
    if v_mov.project_id is not null then
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_mov.lote, v_mov.punto_id, 'cant_devuelta', -v_mov.cantidad);
      perform public.adjust_proyecto_material(v_mov.project_id, v_mov.material_id, v_lote_nuevo, v_mov.punto_id, 'cant_devuelta', v_cant_nueva);
    end if;

  elsif v_mov.tipo = 'ajuste' then -- Conteo: crédito al técnico
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_mov.lote, -v_mov.cantidad, 0, true);
    perform public.adjust_stock(v_mov.ubicacion_id, v_mov.material_id, v_lote_nuevo, v_cant_nueva, 0, true);
  end if;

  update public.movimientos
     set lote     = v_lote_nuevo,
         cantidad = v_cant_nueva,
         nota     = case when p_nota is null then nota else nullif(trim(p_nota), '') end
   where id = p_movimiento_id
   returning * into v_mov;

  return v_mov;
end;
$$;
