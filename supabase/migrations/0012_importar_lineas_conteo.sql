-- Importación de Excel SAP más rápida: antes el cliente hacía 2-4 llamadas
-- de red POR FILA (buscar/crear material, agregar línea, actualizar
-- cantidad), todas secuenciales — con un Excel de un par de cientos de
-- filas eso son cientos de round-trips uno detrás de otro, de ahí la
-- demora. Esta función recibe TODAS las filas ya resueltas a material_id
-- (los materiales nuevos se resuelven aparte, en un solo insert desde el
-- cliente) y hace el alta/actualización de conteo_lineas en un solo
-- viaje de red; el loop corre en la BD, no por la red.
--
-- Mismas reglas que agregar_linea_conteo/actualizar_linea_conteo (conteo
-- abierto + can_move_inventory), verificadas una sola vez al principio.
-- Cada fila corre en su propio sub-bloque para que un error puntual (ej.
-- lote inválido) no aborte el resto del import, igual que el comportamiento
-- anterior fila-por-fila en el cliente.

set check_function_bodies = off;

create or replace function public.importar_lineas_conteo(
  p_conteo_id uuid, p_filas jsonb
) returns table(material_id uuid, lote text, accion text, mensaje text)
language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
  v_fila jsonb;
  v_material_id uuid;
  v_lote text;
  v_cantidad numeric;
  v_linea_id uuid;
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
end;
$$;

grant execute on function public.importar_lineas_conteo(uuid, jsonb) to authenticated;
