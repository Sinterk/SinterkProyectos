-- Sin excepción por umbral (pedido de Andrés, 06-10-2026): "sobre los SKU con
-- umbral, [la fila vacía] debe desaparecer. Es común que si no queda de un
-- tipo, se reabastece con uno similar, por lo que es natural que quede en 0
-- (ej. no queda cable ADSS 32, se reabastece ADSS 24)".
--
-- Reemplaza a 0080 en un punto: allá un material con umbral mínimo en una
-- bodega conservaba UNA fila vacía para sostener la alerta "Renovar". Ahora no:
--   1. adjust_stock (vigente en 0080): borra la fila al quedar en 0 físico y 0
--      digital, para cualquier material. Lo demás es idéntico.
--   2. Se borran las filas 0/0 que quedaron de la 0080 (las ~11 de materiales
--      con umbral). La alerta "Renovar" pasa a mostrarse solo mientras QUEDE algo
--      (cantidad > 0 y <= umbral), no cuando el material se agotó por completo.
--
-- No pierde historial (`stock` es solo el saldo; nada lo referencia).
-- Idempotente.
--
-- ANTES DE CORRER (solo lectura): select count(*) from public.stock where cantidad_fisico = 0 and cantidad_digital = 0;   -- ~11

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

  -- (0079) Antes: greatest(delta, 0). Si la fila NO existía, una salida con
  -- p_permitir_negativo = true creaba la fila en 0/0 y el negativo se perdía
  -- (solo la 2.ª salida quedaba en negativo). Con permitir_negativo = false el
  -- chequeo de arriba ya impide un delta que deje saldo < 0, así que usar el
  -- delta tal cual solo cambia el caso "permitido negativo".
  insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
  values (p_ubicacion_id, p_material_id, p_lote, p_delta_fisico, p_delta_digital)
  on conflict (ubicacion_id, material_id, lote) do update
    set cantidad_fisico = stock.cantidad_fisico + p_delta_fisico,
        cantidad_digital = stock.cantidad_digital + p_delta_digital;

  -- (0081) Un lote que queda en 0 físico y 0 digital no se deja pegado al
  -- stock: la fila se borra, SIN excepciones (el historial vive en
  -- `movimientos`, no acá). Es normal que un material con umbral se agote
  -- cuando se repone con uno similar (ej. se acaba ADSS 32 y se compra ADSS 24):
  -- no debe quedar una fila vacía ni una alerta "Renovar" para él. Negativos y
  -- lotes con cualquier cantidad (física o digital) no se tocan.
  delete from public.stock s
   where s.ubicacion_id = p_ubicacion_id and s.material_id = p_material_id and s.lote = p_lote
     and s.cantidad_fisico = 0 and s.cantidad_digital = 0;
end;
$$;

-- ── Limpieza: todas las filas vacías que queden ──────────────────────────────
delete from public.stock where cantidad_fisico = 0 and cantidad_digital = 0;

-- ── Verificación (solo lectura): debe dar 0 ──────────────────────────────────
select count(*) as filas_vacias_que_quedan from public.stock where cantidad_fisico = 0 and cantidad_digital = 0;
