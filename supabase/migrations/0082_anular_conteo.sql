-- Anular un conteo CERRADO (ej. un conteo de prueba que se cerró). Deshace lo
-- que hizo `cerrar_conteo`: revierte el ajuste de stock de cada línea con
-- diferencia y borra los eventos que abrió; después borra el conteo
-- (conteo_lineas cae por cascade). Para un conteo abierto sigue estando
-- `descartar_conteo` (0011), que no toca stock.
--
-- POR QUÉ SOLO EL ÚLTIMO
-- Un conteo deja el stock anclado a lo contado: stock = contado + movimientos
-- posteriores. Revertir su ajuste (restar contado − sistema) deja
-- stock = sistema + movimientos posteriores, o sea, lo que habría sin ese
-- conteo — pero SOLO si ningún conteo posterior volvió a anclar el mismo
-- material/lote. Si lo hizo, ese conteo ya fijó el stock real y anular el
-- anterior no debería moverlo; lo que cambiaría es la diferencia que registró
-- el posterior (y sus eventos). Eso no se recalcula: la función se niega y
-- pide anular primero el más reciente.
--
-- Se bloquea también si:
--  - otro conteo de la misma ubicación/naturaleza con alguno de esos
--    material/lote sigue ABIERTO: su foto del sistema ya incluye este ajuste
--    y al cerrarse lo volvería a aplicar.
--  - alguno de sus eventos ya tiene resoluciones (reconocido, merma,
--    reasignación…): pueden haber generado movimientos propios. Hay que
--    deshacerlas antes.
--
-- Solo admin: es un ajuste de stock masivo sin movimiento que lo respalde.

set check_function_bodies = off;

create or replace function public.anular_conteo(p_conteo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_conteo public.conteos%rowtype;
  v_bloqueo record;
  v_linea record;
  v_diferencia numeric;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede anular un conteo cerrado';
  end if;

  select * into v_conteo from public.conteos where id = p_conteo_id for update;
  if v_conteo.id is null then raise exception 'Conteo no encontrado'; end if;
  if v_conteo.estado <> 'cerrado' then
    raise exception 'El conteo está abierto: usa "Descartar conteo"';
  end if;

  -- Otro conteo (posterior, o todavía abierto) que tocó alguno de los mismos
  -- material/lote en la misma ubicación y naturaleza.
  select c.id, c.fecha, c.estado, c.created_at, m.sku || ' ' || m.descripcion as material
    into v_bloqueo
  from public.conteos c
  join public.conteo_lineas cl on cl.conteo_id = c.id
  join public.conteo_lineas mia on mia.conteo_id = p_conteo_id
                               and mia.material_id = cl.material_id
                               and mia.lote = cl.lote
  join public.materiales m on m.id = cl.material_id
  where c.id <> p_conteo_id
    and c.ubicacion_id = v_conteo.ubicacion_id
    and c.naturaleza = v_conteo.naturaleza
    and (c.estado = 'abierto' or c.created_at > v_conteo.created_at)
  order by c.created_at desc
  limit 1;
  if v_bloqueo.id is not null then
    raise exception 'No es el último conteo de "%" en esta ubicación: hay uno % del % que lo vuelve a contar. Anula ese primero.',
      v_bloqueo.material,
      case when v_bloqueo.estado = 'abierto' then 'abierto' else 'cerrado' end,
      to_char(v_bloqueo.fecha, 'DD-MM-YYYY');
  end if;

  if exists (
    select 1
    from public.eventos_inventario e
    join public.conteo_lineas cl on cl.id = e.conteo_linea_id
    where cl.conteo_id = p_conteo_id
      and (e.estado <> 'abierto' or e.cantidad_resuelta <> 0
           or exists (select 1 from public.eventos_inventario_resoluciones r where r.evento_id = e.id))
  ) then
    raise exception 'Este conteo tiene diferencias ya resueltas (reconocidas, merma, reasignación…). Deshaz esas resoluciones antes de anular el conteo.';
  end if;

  -- Revertir el ajuste exacto que aplicó cerrar_conteo, línea por línea.
  for v_linea in
    select material_id, lote, cantidad_contada, cantidad_sistema
    from public.conteo_lineas where conteo_id = p_conteo_id
  loop
    v_diferencia := v_linea.cantidad_contada - v_linea.cantidad_sistema;
    if v_diferencia <> 0 then
      if v_conteo.naturaleza = 'fisico' then
        perform public.adjust_stock(v_conteo.ubicacion_id, v_linea.material_id, v_linea.lote, -v_diferencia, 0, true);
      else
        perform public.adjust_stock(v_conteo.ubicacion_id, v_linea.material_id, v_linea.lote, 0, -v_diferencia, true);
      end if;
    end if;
  end loop;

  -- conteo_linea_id es "on delete set null": sin este delete los eventos
  -- quedarían huérfanos, abiertos y pidiendo resolución.
  delete from public.eventos_inventario e
  using public.conteo_lineas cl
  where cl.id = e.conteo_linea_id and cl.conteo_id = p_conteo_id;

  delete from public.conteos where id = p_conteo_id;
end;
$$;

revoke execute on function public.anular_conteo(uuid) from public, anon;
grant execute on function public.anular_conteo(uuid) to authenticated;
