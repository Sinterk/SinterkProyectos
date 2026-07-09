-- Dos cambios pedidos tras probar Inventario:
-- 1) El stock puede quedar negativo (descuadre a revisar), ya no es un
--    error bloqueante — adjust_stock deja de lanzar excepción por stock
--    insuficiente. La UI marca visualmente las cantidades negativas.
-- 2) Umbral de alerta por material ("hay que renovar"): materiales.stock_minimo,
--    nullable (null = sin umbral configurado).

alter table public.materiales add column if not exists stock_minimo numeric;

-- `stock.cantidad_fisico`/`cantidad_digital` traían un CHECK >= 0 desde
-- 0001_init.sql — hay que quitarlo, si no la función de abajo puede dejar
-- de lanzar su propia excepción pero Postgres igual rechaza el UPDATE con
-- un error de constraint. Nombres de constraint no se asumen (ver gotcha
-- de este mismo repo): se buscan dinámicamente por columna.
do $do$
declare
  v_con text;
begin
  for v_con in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
    where rel.relname = 'stock' and con.contype = 'c'
      and att.attname in ('cantidad_fisico', 'cantidad_digital')
  loop
    execute format('alter table public.stock drop constraint %I', v_con);
  end loop;
end;
$do$;

set check_function_bodies = off;

create or replace function public.adjust_stock(
  p_ubicacion_id uuid, p_material_id uuid, p_lote text,
  p_delta_fisico numeric default 0, p_delta_digital numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
  values (p_ubicacion_id, p_material_id, p_lote, p_delta_fisico, p_delta_digital)
  on conflict (ubicacion_id, material_id, lote) do update
    set cantidad_fisico = stock.cantidad_fisico + p_delta_fisico,
        cantidad_digital = stock.cantidad_digital + p_delta_digital;
end;
$$;
