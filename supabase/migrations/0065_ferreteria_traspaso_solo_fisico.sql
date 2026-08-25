-- Corrige el alcance de 0064 (esa migración ya corrió, no se edita — se
-- reemplaza acá). Andrés pidió dos ajustes sobre el traspaso de lote de
-- Ferretería:
--
--   1. Alcance más amplio: 0064 solo traspasaba el lote 'SinDefinir'. Ahora
--      se traspasa CUALQUIER lote físico (no solo 'SinDefinir') a 'Físico'
--      para materiales Ferretería — el físico de estos materiales nunca se
--      distingue por lote, sin importar en qué lote haya llegado.
--
--   2. Alcance más angosto (el cambio importante): el traspaso ahora es
--      SOLO del lado físico. El lado digital (cantidad_digital en stock,
--      cant_rebajada en proyecto_materiales, movimientos con
--      naturaleza='digital') queda intacto bajo el lote real que entrega
--      SAP — Andrés: "en digital se deben mantener los lotes que indica
--      SAP". Es posible porque físico y digital son columnas separadas en
--      la misma fila (stock.cantidad_fisico/cantidad_digital,
--      proyecto_materiales.cant_entregada.../cant_rebajada) y movimientos
--      trae `naturaleza` por fila — se puede mover una sin tocar la otra,
--      aunque compartan la misma fila/lote.
create or replace function public.traspasar_fisico_ferreteria_a_lote_unico(p_material_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- stock: PK (ubicacion_id, material_id, lote). Se acumula el físico de
  -- todo lote != 'Físico' en la fila 'Físico' (por ubicación); la fila
  -- 'Físico' recibe cantidad_digital = 0 en el insert (si ya tenía digital
  -- propio, el ON CONFLICT no lo toca, queda como estaba).
  insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
  select ubicacion_id, material_id, 'Físico', sum(cantidad_fisico), 0
    from public.stock
    where material_id = p_material_id and lote <> 'Físico' and cantidad_fisico <> 0
    group by ubicacion_id, material_id
  on conflict (ubicacion_id, material_id, lote) do update
    set cantidad_fisico = stock.cantidad_fisico + excluded.cantidad_fisico;

  -- Se limpia SOLO el físico de las filas de origen — cantidad_digital
  -- (el lote real de SAP) queda como estaba.
  update public.stock set cantidad_fisico = 0
    where material_id = p_material_id and lote <> 'Físico' and cantidad_fisico <> 0;

  -- Filas que quedaron en 0/0 (sin físico ni digital) ya no aportan nada.
  delete from public.stock
    where material_id = p_material_id and lote <> 'Físico'
      and cantidad_fisico = 0 and cantidad_digital = 0;

  -- movimientos: `naturaleza` es por fila ('fisico'/'digital'), así que
  -- renombrar el lote de los movimientos físicos no toca los digitales
  -- (esos guardan el lote real de SAP, tal cual se registraron).
  update public.movimientos set lote = 'Físico'
    where material_id = p_material_id and naturaleza = 'fisico' and lote <> 'Físico';

  -- proyecto_materiales: mismo criterio que stock, pero acá lo físico son 4
  -- columnas (entregada/instalada/devuelta/rezagada) y lo digital es
  -- cant_rebajada. Se procesa cada índice único parcial por separado
  -- (con/sin punto_id, ver 0003_inventario_logistica.sql). origen_ubicacion_id
  -- no es parte de la clave única — se agrega con (array_agg(...))[1] (uuid no
  -- tiene max()/min() como agregado nativo en Postgres) para no intentar
  -- afectar la misma fila dos veces en el mismo INSERT si distintos lotes de
  -- origen traían valores distintos ahí (dato ya arbitrario desde 0064).
  insert into public.proyecto_materiales (
    project_id, material_id, lote, punto_id, origen_ubicacion_id,
    cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
  )
  select project_id, material_id, 'Físico', punto_id, (array_agg(origen_ubicacion_id))[1],
         sum(cant_entregada), sum(cant_instalada), sum(cant_devuelta), sum(cant_rezagada), 0
    from public.proyecto_materiales
    where material_id = p_material_id and lote <> 'Físico' and punto_id is null
      and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0)
    group by project_id, material_id, punto_id
  on conflict (project_id, material_id, lote) where punto_id is null do update
    set cant_entregada = proyecto_materiales.cant_entregada + excluded.cant_entregada,
        cant_instalada = proyecto_materiales.cant_instalada + excluded.cant_instalada,
        cant_devuelta  = proyecto_materiales.cant_devuelta  + excluded.cant_devuelta,
        cant_rezagada  = proyecto_materiales.cant_rezagada  + excluded.cant_rezagada;

  update public.proyecto_materiales
    set cant_entregada = 0, cant_instalada = 0, cant_devuelta = 0, cant_rezagada = 0
    where material_id = p_material_id and lote <> 'Físico' and punto_id is null
      and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0);

  delete from public.proyecto_materiales
    where material_id = p_material_id and lote <> 'Físico' and punto_id is null
      and cant_entregada = 0 and cant_instalada = 0 and cant_devuelta = 0
      and cant_rezagada = 0 and cant_rebajada = 0;

  insert into public.proyecto_materiales (
    project_id, material_id, lote, punto_id, origen_ubicacion_id,
    cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
  )
  select project_id, material_id, 'Físico', punto_id, (array_agg(origen_ubicacion_id))[1],
         sum(cant_entregada), sum(cant_instalada), sum(cant_devuelta), sum(cant_rezagada), 0
    from public.proyecto_materiales
    where material_id = p_material_id and lote <> 'Físico' and punto_id is not null
      and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0)
    group by project_id, material_id, punto_id
  on conflict (project_id, material_id, lote, punto_id) where punto_id is not null do update
    set cant_entregada = proyecto_materiales.cant_entregada + excluded.cant_entregada,
        cant_instalada = proyecto_materiales.cant_instalada + excluded.cant_instalada,
        cant_devuelta  = proyecto_materiales.cant_devuelta  + excluded.cant_devuelta,
        cant_rezagada  = proyecto_materiales.cant_rezagada  + excluded.cant_rezagada;

  update public.proyecto_materiales
    set cant_entregada = 0, cant_instalada = 0, cant_devuelta = 0, cant_rezagada = 0
    where material_id = p_material_id and lote <> 'Físico' and punto_id is not null
      and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0);

  delete from public.proyecto_materiales
    where material_id = p_material_id and lote <> 'Físico' and punto_id is not null
      and cant_entregada = 0 and cant_instalada = 0 and cant_devuelta = 0
      and cant_rezagada = 0 and cant_rebajada = 0;
end;
$$;

-- El trigger de reclasificación (materiales_ferreteria_traspaso, creado en
-- 0064) sigue apuntando a esta misma función por nombre — solo cambia qué
-- función interna llama.
create or replace function public.trigger_ferreteria_traspaso_lote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nuevo_es_ferreteria boolean;
  v_viejo_es_ferreteria boolean;
begin
  select lower(trim(nombre)) = 'ferretería' into v_nuevo_es_ferreteria
    from public.material_tipos where id = new.tipo_id;
  select lower(trim(nombre)) = 'ferretería' into v_viejo_es_ferreteria
    from public.material_tipos where id = old.tipo_id;

  if coalesce(v_nuevo_es_ferreteria, false) and not coalesce(v_viejo_es_ferreteria, false) then
    perform public.traspasar_fisico_ferreteria_a_lote_unico(new.id);
  end if;
  return new;
end;
$$;

-- Retroactivo: se vuelve a correr para TODOS los materiales que ya son
-- Ferretería hoy, ahora con el alcance ampliado (todo lote, no solo
-- 'SinDefinir') y la separación físico/digital.
do $$
declare
  v_material_id uuid;
begin
  for v_material_id in
    select id from public.materiales
    where tipo_id in (select id from public.material_tipos where lower(trim(nombre)) = 'ferretería')
  loop
    perform public.traspasar_fisico_ferreteria_a_lote_unico(v_material_id);
  end loop;
end $$;

-- La función de 0064 queda obsoleta (nada del cliente la invoca — solo la
-- llamaba el trigger, ya reapuntado arriba). Se elimina para que no quede
-- una versión vieja e incorrecta (mezclaba físico y digital) invocable.
drop function if exists public.traspasar_lote_sindefinir_a_fisico(uuid);
