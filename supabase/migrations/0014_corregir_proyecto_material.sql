-- Corrección directa de un error de tipeo en proyecto_materiales
-- (Entregado/Instalado/Devuelto/Rebajado): sobreescribe el número tal cual,
-- sin generar un movimiento ni tocar `stock`. A diferencia de
-- registrar_movimiento (ver 0005), esto es deliberadamente "no atómico con
-- el stock" — es solo para arreglar un valor mal escrito, nunca para
-- registrar algo que de verdad pasó (para eso está "Registrar movimiento").
-- Por eso mismo NO incluye Solicitado: esa cantidad no vive en esta tabla,
-- se calcula sumando movimientos tipo='solicitud'.
--
-- Mismo patrón de upsert que adjust_proyecto_material (0005): dos índices
-- únicos parciales según haya o no punto_id.

set check_function_bodies = off;

create or replace function public.corregir_proyecto_material(
  p_project_id uuid, p_material_id uuid, p_lote text, p_punto_id uuid,
  p_campo text, p_valor numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_campo not in ('cant_entregada', 'cant_instalada', 'cant_devuelta', 'cant_rebajada') then
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

grant execute on function public.corregir_proyecto_material(uuid, uuid, text, uuid, text, numeric) to authenticated;
