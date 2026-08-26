-- Pedido de Andrés: los materiales de tipo "Ferretería" del Catálogo
-- (cruceta, tornillería, abrazaderas…) no tienen lote físico distinguible en
-- la vida real — obligar a elegir "cualquier lote disponible" en cada
-- Entrega/Instalado solo generaba descuadre. El cliente deja de mostrar el
-- selector de lote para estos materiales y usa un único lote fijo,
-- `'Físico'`, en todo movimiento físico (ver esFerreteria.ts).
--
-- Esta migración traspasa lo que hoy vive en el lote `'SinDefinir'` (el
-- valor por defecto histórico cuando no se elegía lote) a `'Físico'` para
-- los materiales que ya son Ferretería, y deja un TRIGGER para que el mismo
-- traspaso ocurra solo cada vez que un material se reclasifique a
-- Ferretería en el futuro — sin importar por dónde cambie `tipo_id`
-- (Catálogo hoy, cualquier otra vía mañana), mismo criterio que
-- `handle_new_user`/`set_updated_at` en este proyecto: la regla vive en la
-- base, no en el código del cliente.
--
-- Qué hace el traspaso, por tabla:
--   * `movimientos` — UPDATE directo del lote. Es un libro histórico sin
--     restricción de unicidad por lote, no hay nada que fusionar.
--   * `stock` y `proyecto_materiales` — SÍ tienen unique constraint sobre
--     lote (PK en `stock`; dos índices únicos parciales por punto_id en
--     `proyecto_materiales`, ver 0003_inventario_logistica.sql). Si ya
--     existiera una fila `'Físico'` con saldo propio para esa
--     ubicación/proyecto (poco probable, pero posible), se SUMA en vez de
--     reventar por choque de clave. Andrés ya avisó que un cruce ahí "se
--     cuadra a mano después con Conteo" — no hace falta lógica más fina.
create or replace function public.traspasar_lote_sindefinir_a_fisico(p_material_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- stock: PK (ubicacion_id, material_id, lote)
  insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
  select ubicacion_id, material_id, 'Físico', cantidad_fisico, cantidad_digital
    from public.stock
    where material_id = p_material_id and lote = 'SinDefinir'
  on conflict (ubicacion_id, material_id, lote) do update
    set cantidad_fisico  = stock.cantidad_fisico  + excluded.cantidad_fisico,
        cantidad_digital = stock.cantidad_digital + excluded.cantidad_digital;
  delete from public.stock where material_id = p_material_id and lote = 'SinDefinir';

  -- movimientos: sin unique por lote, UPDATE directo.
  update public.movimientos set lote = 'Físico' where material_id = p_material_id and lote = 'SinDefinir';

  -- proyecto_materiales: dos índices únicos parciales (con/sin punto_id) —
  -- se procesan por separado, cada uno apuntando a su propio índice.
  insert into public.proyecto_materiales (
    project_id, material_id, lote, punto_id, origen_ubicacion_id,
    cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
  )
  select project_id, material_id, 'Físico', punto_id, origen_ubicacion_id,
         cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
    from public.proyecto_materiales
    where material_id = p_material_id and lote = 'SinDefinir' and punto_id is null
  on conflict (project_id, material_id, lote) where punto_id is null do update
    set cant_entregada = proyecto_materiales.cant_entregada + excluded.cant_entregada,
        cant_instalada = proyecto_materiales.cant_instalada + excluded.cant_instalada,
        cant_devuelta  = proyecto_materiales.cant_devuelta  + excluded.cant_devuelta,
        cant_rezagada  = proyecto_materiales.cant_rezagada  + excluded.cant_rezagada,
        cant_rebajada  = proyecto_materiales.cant_rebajada  + excluded.cant_rebajada;
  delete from public.proyecto_materiales where material_id = p_material_id and lote = 'SinDefinir' and punto_id is null;

  insert into public.proyecto_materiales (
    project_id, material_id, lote, punto_id, origen_ubicacion_id,
    cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
  )
  select project_id, material_id, 'Físico', punto_id, origen_ubicacion_id,
         cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
    from public.proyecto_materiales
    where material_id = p_material_id and lote = 'SinDefinir' and punto_id is not null
  on conflict (project_id, material_id, lote, punto_id) where punto_id is not null do update
    set cant_entregada = proyecto_materiales.cant_entregada + excluded.cant_entregada,
        cant_instalada = proyecto_materiales.cant_instalada + excluded.cant_instalada,
        cant_devuelta  = proyecto_materiales.cant_devuelta  + excluded.cant_devuelta,
        cant_rezagada  = proyecto_materiales.cant_rezagada  + excluded.cant_rezagada,
        cant_rebajada  = proyecto_materiales.cant_rebajada  + excluded.cant_rebajada;
  delete from public.proyecto_materiales where material_id = p_material_id and lote = 'SinDefinir' and punto_id is not null;
end;
$$;

-- Trigger: dispara solo en la TRANSICIÓN a Ferretería (antes no lo era, el
-- tipo nuevo sí) — "Ferretería" se resuelve por nombre (igual que
-- esTipoFerreteria en el cliente), no por id fijo.
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
    perform public.traspasar_lote_sindefinir_a_fisico(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists materiales_ferreteria_traspaso on public.materiales;
create trigger materiales_ferreteria_traspaso
  after update of tipo_id on public.materiales
  for each row execute function public.trigger_ferreteria_traspaso_lote();

-- Retroactivo: materiales YA clasificados como Ferretería hoy. No se hace
-- vía el trigger de arriba (tipo_id no cambia, así que "antes no lo era"
-- sería falso) — se llama la función directo para cada uno.
do $$
declare
  v_material_id uuid;
begin
  for v_material_id in
    select id from public.materiales
    where tipo_id in (select id from public.material_tipos where lower(trim(nombre)) = 'ferretería')
  loop
    perform public.traspasar_lote_sindefinir_a_fisico(v_material_id);
  end loop;
end $$;
