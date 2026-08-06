-- Bug real encontrado por Andrés: borrar un informe (proyecto) con
-- movimientos de inventario asociados fallaba con
-- "violates foreign key constraint movimientos_project_id_fkey" — un admin
-- real, con rol correcto, no podía borrar un informe normal con actividad
-- de Logística (que es casi cualquier informe real).
--
-- Causa: a diferencia de la mayoría de columnas que referencian
-- `projects(id)` (informes/tramos/hitos/incidencias/ep_informes/
-- observaciones/proyecto_materiales, todas con `on delete cascade` desde
-- que se crearon) y de `movimientos.punto_id` (agregado en
-- 0003_inventario_logistica.sql ya con `on delete set null`), estas tres
-- columnas se agregaron SIN ninguna acción de borrado — Postgres usa
-- `NO ACTION` por defecto, que bloquea el DELETE del lado "padre" si existe
-- al menos una fila hija.
--
-- Se corrige a SET NULL, no CASCADE: son registros que deben sobrevivir al
-- proyecto (historial real, no datos "propiedad" del proyecto):
--  - `movimientos.project_id`: el movimiento de inventario (quién sacó qué
--    material, cuándo) sigue siendo un hecho real aunque el proyecto se
--    borre — queda "Sin proyecto", mismo estado que ya soporta toda la UI
--    para "salida preventiva" (Movimientos, getTecnicoLedger, etc.).
--  - `eventos_inventario_resoluciones.project_id`: mismo criterio, es
--    historial de cómo se resolvió un evento de conteo.
--  - `projects.copied_from_id` (autoreferencia, versionado por copia): si
--    se borra la versión original, la copia no debe desaparecer con ella
--    (CASCADE sería catastrófico acá) — solo pierde el puntero a su origen.
do $do$
declare
  v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'movimientos' and con.contype = 'f' and att.attname = 'project_id';
  if v_con is not null then
    execute format('alter table public.movimientos drop constraint %I', v_con);
  end if;
end;
$do$;
alter table public.movimientos
  add constraint movimientos_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

do $do$
declare
  v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'eventos_inventario_resoluciones' and con.contype = 'f' and att.attname = 'project_id';
  if v_con is not null then
    execute format('alter table public.eventos_inventario_resoluciones drop constraint %I', v_con);
  end if;
end;
$do$;
alter table public.eventos_inventario_resoluciones
  add constraint eventos_inventario_resoluciones_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

do $do$
declare
  v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'projects' and con.contype = 'f' and att.attname = 'copied_from_id';
  if v_con is not null then
    execute format('alter table public.projects drop constraint %I', v_con);
  end if;
end;
$do$;
alter table public.projects
  add constraint projects_copied_from_id_fkey
  foreign key (copied_from_id) references public.projects(id) on delete set null;
