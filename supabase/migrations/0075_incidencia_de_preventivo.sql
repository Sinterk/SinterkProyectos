-- Enlace Preventivos → Incidencias (pedido de Andrés, 05-10-2026).
--
-- Contexto: cuando un cuadrante (preventivo) se cierra y se envía el informe
-- a Entel, Entel le asigna una incidencia, y el material usado se rebaja bajo
-- ese número. Hasta ahora esa incidencia se creaba a mano en el módulo de
-- Incidencias y el material había que pasárselo. Ahora:
--
--   * Al CERRAR un cuadrante se crea sola UNA incidencia (una por cuadrante),
--     enlazada con `projects.preventivo_id`. Nace sin número (`ott = ''`):
--     mientras Entel no la asigne, se reconoce por comuna/cuadrante/semana/año
--     (datos que la pantalla lee del cuadrante enlazado). El número se escribe
--     después, a mano, en la ventana de la incidencia — el informe no lo lleva.
--   * El material NO se copia ni se mueve: sigue registrado contra el
--     cuadrante. La incidencia enlazada muestra y rebaja esa misma tabla (ver
--     `preventivoId` en el cliente), así no se duplican movimientos ni stock y
--     reabrir/corregir el cuadrante se refleja solo.
--   * Ingeniero y dirección de la incidencia se copian del informe del
--     cuadrante al crearla (el ingeniero queda editable en la incidencia).
--
-- Idempotente: el índice único parcial garantiza una sola incidencia por
-- cuadrante aunque se cierre, reabra y vuelva a cerrar. No hay backfill: los
-- cuadrantes ya cerrados quedan como están (sus incidencias, si existen, se
-- crearon a mano y tienen su propio material).

alter table public.projects
  add column if not exists preventivo_id uuid references public.projects(id) on delete set null;

create unique index if not exists projects_preventivo_id_key
  on public.projects (preventivo_id) where preventivo_id is not null;

create or replace function public.crear_incidencia_de_preventivo()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_inf public.informes_preventivo;
begin
  select * into v_inf from public.informes_preventivo where project_id = new.id limit 1;

  insert into public.projects (ott, area, subarea, estado, comuna, direccion, ingeniero_proyecto, preventivo_id, created_by)
  values ('', 'OyM', 'incidencia', 'activo', new.comuna, v_inf.direccion, v_inf.responsable, new.id, new.created_by)
  on conflict (preventivo_id) where preventivo_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists projects_crear_incidencia_preventivo on public.projects;
create trigger projects_crear_incidencia_preventivo
  after update of estado on public.projects
  for each row
  when (new.estado = 'cerrado' and old.estado is distinct from 'cerrado'
        and new.area = 'OyM' and new.subarea = 'preventivo')
  execute function public.crear_incidencia_de_preventivo();
