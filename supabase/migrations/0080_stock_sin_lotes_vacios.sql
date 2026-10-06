-- Lotes en 0 pegados al stock (pedido de Andrés, 06-10-2026): "que no
-- aparezcan los lotes en 0 en el stock, solo en el historial".
--
--   1. adjust_stock (vigente en 0079): al terminar, borra la fila si quedó en
--      0 físico y 0 digital. Excepción: el material con umbral mínimo
--      (materiales.stock_minimo) en una BODEGA conserva su fila vacía, porque
--      es lo que dispara la alerta "Renovar" de la pestaña Bodega. Lo demás
--      es idéntico a 0079 (que incluye el arreglo del negativo perdido).
--   2. Limpieza de lo que ya quedó: borra las filas 0/0 existentes con la misma
--      excepción — de los materiales con umbral en bodegas queda UNA fila vacía
--      por (bodega, material) cuando no tiene ningún otro lote con cantidad.
--
-- No pierde historial: `stock` es solo el saldo actual; cada movimiento, conteo y
-- evento conserva su lote. Nada referencia filas de `stock` (sin claves foráneas).
-- Idempotente: volver a correrla no cambia nada.
--
-- ANTES DE CORRER (solo lectura) — cuántas filas se borrarían:
--   select count(*) from public.stock where cantidad_fisico = 0 and cantidad_digital = 0;      -- vacías (hoy 191 de 607)
--   (de esas, ~11 se conservan por tener umbral mínimo en una bodega)

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

  -- (0080) Un lote que queda en 0 físico y 0 digital no se deja pegado al
  -- stock: la fila se borra (el historial vive en `movimientos`, no acá). Se
  -- conserva SOLO la fila vacía de un material con umbral mínimo en una bodega:
  -- es lo que mantiene la alerta "Renovar" cuando se agota. Negativos y lotes
  -- con cualquier cantidad (física o digital) no se tocan.
  delete from public.stock s
   where s.ubicacion_id = p_ubicacion_id and s.material_id = p_material_id and s.lote = p_lote
     and s.cantidad_fisico = 0 and s.cantidad_digital = 0
     and not exists (
       select 1
         from public.materiales m, public.ubicaciones u
        where m.id = p_material_id and m.stock_minimo is not null
          and u.id = p_ubicacion_id and u.tipo = 'bodega');
end;
$$;

-- ── Limpieza de las filas vacías que ya existen ──────────────────────────────
-- (a) Filas 0/0 de TÉCNICOS y de materiales SIN umbral: se borran todas.
delete from public.stock s
 using public.ubicaciones u, public.materiales m
 where u.id = s.ubicacion_id and m.id = s.material_id
   and s.cantidad_fisico = 0 and s.cantidad_digital = 0
   and (u.tipo <> 'bodega' or m.stock_minimo is null);

-- (b) Materiales CON umbral en bodegas: se borra la fila 0/0 si ese material ya
--     tiene otro lote con cantidad en esa bodega, o si hay otra fila 0/0 de
--     lote menor (queda una sola, que sostiene la alerta "Renovar").
delete from public.stock s
 using public.ubicaciones u, public.materiales m
 where u.id = s.ubicacion_id and m.id = s.material_id
   and u.tipo = 'bodega' and m.stock_minimo is not null
   and s.cantidad_fisico = 0 and s.cantidad_digital = 0
   and (
     exists (select 1 from public.stock o
              where o.ubicacion_id = s.ubicacion_id and o.material_id = s.material_id
                and (o.cantidad_fisico <> 0 or o.cantidad_digital <> 0))
     or exists (select 1 from public.stock o
              where o.ubicacion_id = s.ubicacion_id and o.material_id = s.material_id
                and o.cantidad_fisico = 0 and o.cantidad_digital = 0 and o.lote < s.lote)
   );

-- ── Verificación (solo lectura): debe quedar 1 sola fila vacía por (bodega, material con umbral) y ninguna más ──
select
  (select count(*) from public.stock where cantidad_fisico = 0 and cantidad_digital = 0) as filas_vacias_que_quedan,
  (select count(*) from public.stock s
     join public.ubicaciones u on u.id = s.ubicacion_id
     join public.materiales m on m.id = s.material_id
    where s.cantidad_fisico = 0 and s.cantidad_digital = 0
      and (u.tipo <> 'bodega' or m.stock_minimo is null)) as vacias_que_no_deberian_quedar;
