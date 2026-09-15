-- Pedido de Andrés: al subir un Excel de SAP a un conteo, todo lo que ya
-- estaba en el conteo pero NO viene en este archivo debe quedar en 0 (el
-- lote puede haber dejado de existir en SAP) — hasta ahora esas líneas se
-- dejaban intactas con lo que tuvieran contado antes, lo que podía inflar
-- el conteo con stock que ya no está.
--
-- Se agrega al mismo `importar_lineas_conteo` en vez de hacerlo en el
-- cliente: es una sola transacción con el resto del import, y así una
-- carrera con otra edición manual de línea (mismo conteo, otra pestaña) no
-- puede dejar el conteo a medio camino entre lo viejo y lo nuevo.

set check_function_bodies = off;

create or replace function public.importar_lineas_conteo(
  p_conteo_id uuid, p_filas jsonb
) returns table(material_id uuid, lote text, accion text, mensaje text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_estado text;
  v_fila jsonb;
  v_material_id uuid;
  v_lote text;
  v_cantidad numeric;
  v_linea_id uuid;
  v_sin_copiar record;
begin
  select estado into v_estado from public.conteos where id = p_conteo_id;
  if v_estado is null then raise exception 'Conteo no encontrado'; end if;
  if v_estado <> 'abierto' then raise exception 'El conteo ya está cerrado'; end if;
  if not public.can_move_inventory() then raise exception 'No tienes permiso para editar este conteo'; end if;

  for v_fila in select * from jsonb_array_elements(p_filas)
  loop
    begin
      v_material_id := (v_fila->>'material_id')::uuid;
      v_lote := coalesce(nullif(trim(v_fila->>'lote'), ''), 'SinDefinir');
      v_cantidad := (v_fila->>'cantidad')::numeric;

      select id into v_linea_id from public.conteo_lineas
      where conteo_id = p_conteo_id and material_id = v_material_id and lote = v_lote;

      if v_linea_id is not null then
        update public.conteo_lineas set cantidad_contada = v_cantidad where id = v_linea_id;
        material_id := v_material_id; lote := v_lote; accion := 'actualizada'; mensaje := null;
      else
        insert into public.conteo_lineas (conteo_id, material_id, lote, cantidad_contada, cantidad_sistema, primera_vez)
        values (p_conteo_id, v_material_id, v_lote, v_cantidad, 0, true);
        material_id := v_material_id; lote := v_lote; accion := 'creada'; mensaje := null;
      end if;
      return next;
    exception when others then
      material_id := v_material_id; lote := v_lote; accion := 'error'; mensaje := sqlerrm;
      return next;
    end;
  end loop;

  -- Todo lo que ya estaba en el conteo y no vino en este archivo, a 0 —
  -- salvo que ya estuviera en 0 (no hace falta tocarlo ni reportarlo).
  for v_sin_copiar in
    select cl.material_id as mid, cl.lote as lt
    from public.conteo_lineas cl
    where cl.conteo_id = p_conteo_id
      and cl.cantidad_contada <> 0
      and not exists (
        select 1 from jsonb_array_elements(p_filas) f
        where (f->>'material_id')::uuid = cl.material_id
          and coalesce(nullif(trim(f->>'lote'), ''), 'SinDefinir') = cl.lote
      )
  loop
    update public.conteo_lineas set cantidad_contada = 0
    where conteo_id = p_conteo_id and material_id = v_sin_copiar.mid and lote = v_sin_copiar.lt;
    material_id := v_sin_copiar.mid; lote := v_sin_copiar.lt; accion := 'en_cero'; mensaje := null;
    return next;
  end loop;
end;
$$;

grant execute on function public.importar_lineas_conteo(uuid, jsonb) to authenticated;
