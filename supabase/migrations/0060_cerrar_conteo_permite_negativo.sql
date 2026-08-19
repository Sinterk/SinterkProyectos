-- Bug reportado por Andrés: al cerrar un conteo digital de C088 (importado
-- desde planilla), reventaba con:
--
--   cerrar_conteo: Stock físico insuficiente (hay -10, se intentó restar 0)
--
-- Sin sentido a primera vista — un conteo digital no toca stock físico — pero
-- es el mismo bug de fondo que 0055 ya diagnosticó y corrigió en
-- `registrar_movimiento`/`anular_movimiento`: `adjust_stock` no valida "no
-- restes más de lo que hay", valida que el SALDO RESULTANTE no quede
-- negativo — de las DOS naturalezas, sin importar si el delta de esa
-- naturaleza es 0.
--
-- `cerrar_conteo` (0010) llama, para un conteo digital:
--   adjust_stock(ubicacion, material, lote, 0, diferencia)
-- delta_fisico = 0. Pero si ESE material/lote ya tenía stock físico negativo
-- (acá, entregas de otro material — 51024 — que se registraron sin stock;
-- Andrés lo dedujo bien), la guarda evalúa "v_fisico + 0 < 0" → true → revienta,
-- aunque el conteo en curso no tenga nada que ver con lo físico. El mensaje
-- "se intentó restar 0" es la pista: no se intentó restar nada, el saldo YA
-- estaba negativo de antes.
--
-- 0055 dejó esta función explícitamente afuera ("tiene su propia semántica"),
-- pero esa exclusión fue un error para este caso: Conteo es justamente el
-- mecanismo de reconciliación del criterio que el propio proyecto fijó desde
-- 0050 (el negativo se permite, se ve en rojo en Bodega, y se reconcilia acá)
-- — bloquear el cierre por un negativo preexistente en la OTRA naturaleza le
-- impide a Conteo hacer su trabajo.
--
-- Agravante real: el `for` de más abajo no tiene manejo de excepción por
-- línea — al reventar en una línea, se pierden TODAS las de ese conteo, no
-- solo la que tenía el negativo. Con una planilla de decenas de líneas, una
-- sola mala tumbaba el cierre completo.
--
-- Fix: mismo criterio de 0055, aplicado acá — `p_permitir_negativo => true`
-- en las dos llamadas a `adjust_stock`. Cuerpo idéntico al de 0010 salvo eso.
create or replace function public.cerrar_conteo(p_conteo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ubicacion_id uuid;
  v_naturaleza text;
  v_estado text;
  v_linea record;
  v_diferencia numeric;
begin
  select ubicacion_id, naturaleza, estado into v_ubicacion_id, v_naturaleza, v_estado
  from public.conteos where id = p_conteo_id;
  if v_estado is null then raise exception 'Conteo no encontrado'; end if;
  if v_estado <> 'abierto' then raise exception 'El conteo ya está cerrado'; end if;
  if not public.can_move_inventory() then raise exception 'No tienes permiso para cerrar este conteo'; end if;

  for v_linea in
    select id, material_id, lote, cantidad_contada, cantidad_sistema, primera_vez
    from public.conteo_lineas where conteo_id = p_conteo_id
  loop
    v_diferencia := v_linea.cantidad_contada - v_linea.cantidad_sistema;
    if v_diferencia <> 0 then
      if v_naturaleza = 'fisico' then
        perform public.adjust_stock(v_ubicacion_id, v_linea.material_id, v_linea.lote, v_diferencia, 0, true);
      else
        perform public.adjust_stock(v_ubicacion_id, v_linea.material_id, v_linea.lote, 0, v_diferencia, true);
      end if;

      if not v_linea.primera_vez then
        insert into public.eventos_inventario (conteo_linea_id, material_id, ubicacion_id, lote, diferencia, estado)
        values (v_linea.id, v_linea.material_id, v_ubicacion_id, v_linea.lote, v_diferencia, 'abierto');
      end if;
    end if;
  end loop;

  update public.conteos set estado = 'cerrado' where id = p_conteo_id;
end;
$$;
