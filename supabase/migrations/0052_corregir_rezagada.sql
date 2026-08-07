-- "Asignado a técnico" (`cant_rezagada`) pasa a ser una celda editable de la
-- tabla del proyecto, igual que el resto — antes era solo un botón
-- ("→ preventivo") sin forma de corregirlo después.
--
-- `corregir_proyecto_material` no aceptaba ese campo, así que un valor mal
-- puesto quedaba imposible de arreglar desde la app: es exactamente lo que
-- le pasó a Andrés (un "Asignado a técnico" en 1 sin la entrega que lo
-- justificara, dejando Tránsito en −1, y hubo que arreglarlo por SQL a mano).
--
-- Cuerpo idéntico al de 0022_merma.sql salvo ese campo en la lista blanca.
create or replace function public.corregir_proyecto_material(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_campo text, p_valor numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_campo not in ('cant_entregada', 'cant_instalada', 'cant_devuelta', 'cant_rebajada', 'cant_merma', 'cant_rezagada') then
    raise exception 'Campo no reconocido: %', p_campo;
  end if;
  if p_valor < 0 then
    raise exception 'La cantidad no puede ser negativa';
  end if;
  if not public.can_move_inventory() then
    raise exception 'No tienes permiso para corregir este valor';
  end if;

  if p_punto_id is null then
    execute format(
      'insert into public.proyecto_materiales (project_id, material_id, lote, punto_id, %1$I)
       values ($1, $2, $3, null, $4)
       on conflict (project_id, material_id, lote) where punto_id is null
       do update set %1$I = excluded.%1$I',
      p_campo
    ) using p_project_id, p_material_id, p_lote, p_valor;
  else
    execute format(
      'insert into public.proyecto_materiales (project_id, material_id, lote, punto_id, %1$I)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, material_id, lote, punto_id) where punto_id is not null
       do update set %1$I = excluded.%1$I',
      p_campo
    ) using p_project_id, p_material_id, p_lote, p_punto_id, p_valor;
  end if;
end;
$$;
