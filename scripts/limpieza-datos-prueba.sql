-- ============================================================================
-- Limpieza de datos de prueba antes de producción
-- (ver docs/CONTINUAR-BACKEND.md, punto 16 — "Limpieza de datos de prueba
-- antes de producción")
--
-- Cómo usarlo: pegar TODO el archivo en el SQL Editor de Supabase y correrlo
-- de una sola vez cuando llegue el momento del cutover. Corre dentro de una
-- transacción (BEGIN…COMMIT): si algo falla a mitad de camino, Postgres
-- deshace todo automáticamente, no queda a medias.
--
-- Recomendado: correr primero solo el bloque "0. Verificación previa" (son
-- selects, no tocan nada) para confirmar que los conteos tienen sentido antes
-- de comprometerse a borrar.
--
-- Qué NO toca este script (a propósito):
--  - El catálogo real de materiales (import SAP) y el stock físico real de
--    C088/C103/C132.
--  - Los proyectos reales (incluido "Independencia — 1", donde quedó
--    instalado el material de prueba 999903 — esa fila de
--    proyecto_materiales/movimiento sí se limpia porque referencia un SKU de
--    prueba, pero el proyecto en sí no se toca).
--  - La cuenta invitado jp (abarahona.sinterk@gmail.com) — esa se queda.
--  - El borrado del usuario de Auth del técnico invitado (iperez@sinterk.cl)
--    y la limpieza de código (GUEST_TECNICO_* en auth.ts/LoginScreen.tsx/
--    UserMenu.tsx + vars de .env) — eso va aparte, ver el bloque final.
--  - Cualquier proyecto ATT real, incluido lo cargado el 04-08-2026 — el
--    filtro de "proyectos de prueba" es por patrón de OTT, no por fecha, así
--    que no debería tocarlo, pero revisa el detalle del punto 0 igual antes
--    de confirmar.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------
-- 0. Verificación previa (solo lectura) — revisa esto antes de seguir
--
-- IMPORTANTE (04-08-2026): Andrés agregó datos reales en ATT hoy que NO se
-- deben borrar. El filtro de "proyectos de prueba" es por patrón de OTT
-- (empieza con "_verify_" o "test-"), no por fecha — así que un proyecto
-- real de hoy solo caería acá si coincidiera con ese patrón de nombre, cosa
-- rara pero hay que confirmarlo a ojo. Por eso este SELECT ahora lista las
-- filas completas (ott/nombre/área/fecha), no solo el conteo: revisa que
-- CADA fila listada sea realmente de prueba antes de seguir. Si aparece
-- algo de hoy que sí es real, para acá (rollback) y avisa para ajustar el
-- filtro antes de reintentar.
-- ----------------------------------------------------------------------
select id, ott, nombre_proyecto, area, created_at
  from public.projects where ott like '\_verify\_%' escape '\' or ott ilike 'test-%'
  order by created_at desc;
select 'materiales de prueba (999901-999905)' as detalle, count(*)
  from public.materiales where sku in ('999901','999902','999903','999904','999905');
select 'bodega de prueba TEST-IMPORT-VELOCIDAD' as detalle, count(*)
  from public.ubicaciones where nombre ilike 'TEST-IMPORT-VELOCIDAD';
select 'ubicación propia del técnico invitado' as detalle, count(*)
  from public.ubicaciones
  where owner_user_id = (select id from public.profiles where email = 'iperez@sinterk.cl');

-- ----------------------------------------------------------------------
-- 1. IDs objetivo, en tablas temporales (viven solo durante esta transacción)
-- ----------------------------------------------------------------------
create temporary table _t_materiales on commit drop as
  select id from public.materiales
  where sku in ('999901','999902','999903','999904','999905');

create temporary table _t_projects on commit drop as
  select id from public.projects
  where ott like '\_verify\_%' escape '\' or ott ilike 'test-%';

create temporary table _t_ubicaciones on commit drop as
  select id from public.ubicaciones
  where nombre ilike 'TEST-IMPORT-VELOCIDAD'
     or owner_user_id = (select id from public.profiles where email = 'iperez@sinterk.cl');

-- Movimientos que el paso 6 va a borrar — se necesita el set completo acá
-- arriba para poder soltar, antes de borrar, las referencias que le apuntan
-- desde eventos_inventario.movimiento_id (ver paso 2-bis).
create temporary table _t_movimientos on commit drop as
  select id from public.movimientos
  where material_id          in (select id from _t_materiales)
     or ubicacion_id         in (select id from _t_ubicaciones)
     or ubicacion_destino_id in (select id from _t_ubicaciones)
     or project_id           in (select id from _t_projects);

-- ----------------------------------------------------------------------
-- 2. Romper el ciclo movimientos <-> eventos_inventario_resoluciones antes
--    de poder borrar cualquiera de los dos lados
-- ----------------------------------------------------------------------
update public.movimientos set evento_resolucion_id = null
where evento_resolucion_id in (
  select r.id from public.eventos_inventario_resoluciones r
  join public.eventos_inventario e on e.id = r.evento_id
  where e.material_id  in (select id from _t_materiales)
     or e.ubicacion_id in (select id from _t_ubicaciones)
     or r.project_id   in (select id from _t_projects)
);

-- ----------------------------------------------------------------------
-- 2-bis. Soltar eventos_inventario.movimiento_id (agregada en la migración
--    0040, posterior a cuando se escribió este script) para cualquier
--    evento que apunte a un movimiento de prueba — sin importar si el
--    evento en sí califica como "de prueba" (paso 4) o no: si su
--    movimiento_id apunta a uno de los que se borran en el paso 6, hay que
--    soltarlo primero o la FK bloquea el delete.
-- ----------------------------------------------------------------------
update public.eventos_inventario set movimiento_id = null
where movimiento_id in (select id from _t_movimientos);

-- ----------------------------------------------------------------------
-- 3. Resoluciones de eventos de prueba (o que referencian un proyecto de prueba)
-- ----------------------------------------------------------------------
delete from public.eventos_inventario_resoluciones r
using public.eventos_inventario e
where r.evento_id = e.id
  and (e.material_id  in (select id from _t_materiales)
    or e.ubicacion_id in (select id from _t_ubicaciones)
    or r.project_id   in (select id from _t_projects));

-- ----------------------------------------------------------------------
-- 4. Eventos de inventario de prueba
-- ----------------------------------------------------------------------
delete from public.eventos_inventario
where material_id  in (select id from _t_materiales)
   or ubicacion_id in (select id from _t_ubicaciones);

-- ----------------------------------------------------------------------
-- 5. Conteos y sus líneas
-- ----------------------------------------------------------------------
delete from public.conteo_lineas
where material_id in (select id from _t_materiales)
   or conteo_id in (select id from public.conteos where ubicacion_id in (select id from _t_ubicaciones));

delete from public.conteos where ubicacion_id in (select id from _t_ubicaciones);

-- ----------------------------------------------------------------------
-- 6. Movimientos de prueba (mismo set calculado en _t_movimientos, arriba)
-- ----------------------------------------------------------------------
delete from public.movimientos where id in (select id from _t_movimientos);

-- ----------------------------------------------------------------------
-- 7. Ciclo de material por proyecto — redundante con el cascade de
--    projects, pero necesario para el 999903 instalado en el proyecto REAL
--    "Independencia — 1" (ver PASO 36 en CONTINUAR-BACKEND.md)
-- ----------------------------------------------------------------------
delete from public.proyecto_materiales
where material_id in (select id from _t_materiales)
   or project_id  in (select id from _t_projects);

-- ----------------------------------------------------------------------
-- 8. Stock — redundante con el cascade de materiales/ubicaciones, explícito
--    por claridad
-- ----------------------------------------------------------------------
delete from public.stock
where material_id  in (select id from _t_materiales)
   or ubicacion_id in (select id from _t_ubicaciones);

-- ----------------------------------------------------------------------
-- 9. Proyectos de prueba — cascada automática hacia informes/tramos/hitos/
--    fotos/informes_preventivo/puntos/incidencia_fotos/project_members/
--    observaciones (todas tienen "on delete cascade" desde projects)
-- ----------------------------------------------------------------------
delete from public.projects where id in (select id from _t_projects);

-- ----------------------------------------------------------------------
-- 10. Materiales y ubicaciones de prueba
-- ----------------------------------------------------------------------
delete from public.materiales  where id in (select id from _t_materiales);
delete from public.ubicaciones where id in (select id from _t_ubicaciones);

-- ----------------------------------------------------------------------
-- 11. Datos de prueba de features agregadas DESPUÉS de que se escribió este
--     script (Sugerencias, Catálogo de materiales) — agregado 01-08-2026.
-- ----------------------------------------------------------------------
-- Sugerencia de prueba enviada al verificar la función (el cuerpo lo dice
-- explícitamente: "se puede borrar").
delete from public.sugerencias
where cuerpo ilike '%verificación de la función de sugerencias%';

-- Proveedor de prueba creado al verificar "+ Nuevo proveedor…" en Catálogo
-- (cascada sola hacia material_proveedores vía on delete cascade).
delete from public.proveedores where nombre = 'PruebaProveedorBorrar';

-- ----------------------------------------------------------------------
-- 0-bis. Verificación posterior — debería dar 0 en todo
-- ----------------------------------------------------------------------
select 'quedan proyectos de prueba' as detalle, count(*) from public.projects
  where ott like '\_verify\_%' escape '\' or ott ilike 'test-%';
select 'quedan materiales de prueba' as detalle, count(*) from public.materiales
  where sku in ('999901','999902','999903','999904','999905');
select 'queda la bodega de prueba' as detalle, count(*) from public.ubicaciones
  where nombre ilike 'TEST-IMPORT-VELOCIDAD';
select 'queda la sugerencia de prueba' as detalle, count(*) from public.sugerencias
  where cuerpo ilike '%verificación de la función de sugerencias%';
select 'queda el proveedor de prueba' as detalle, count(*) from public.proveedores
  where nombre = 'PruebaProveedorBorrar';

commit;
-- Si algo se ve mal en la verificación posterior, correr "rollback;" en vez
-- de confiar en el "commit;" de arriba (o sea: revisar ANTES de pegar el
-- archivo completo si hay dudas, separando el commit final a mano).

-- ============================================================================
-- 11. (Aparte, NO forma parte de la transacción de arriba — revisar antes de
--     correrlo) Desvincular al técnico invitado de historial en proyectos
--     REALES, para poder borrar su cuenta de Auth sin que la BD lo bloquee
--     por referencias (movimientos.usuario_id, resoluciones, etc. no tienen
--     cascade). Esto NO borra esas filas, solo les saca el nombre —
--     el movimiento/resolución en sí queda intacto para la trazabilidad.
--     Correr solo cuando ya no haga falta que "iperez@sinterk.cl" quede
--     identificado en el historial real.
-- ----------------------------------------------------------------------
-- update public.movimientos set usuario_id = null
--   where usuario_id = (select id from public.profiles where email = 'iperez@sinterk.cl');
-- update public.eventos_inventario set resuelto_por = null
--   where resuelto_por = (select id from public.profiles where email = 'iperez@sinterk.cl');
-- update public.eventos_inventario_resoluciones set resuelto_por = null
--   where resuelto_por = (select id from public.profiles where email = 'iperez@sinterk.cl');
-- update public.eventos_inventario_resoluciones set tecnico_user_id = null
--   where tecnico_user_id = (select id from public.profiles where email = 'iperez@sinterk.cl');
-- delete from public.project_members
--   where user_id = (select id from public.profiles where email = 'iperez@sinterk.cl');

-- ============================================================================
-- 12. Pasos finales que NO son SQL:
--   a) ✅ HECHO (01-08-2026, antes del cutover): se sacó el flujo de invitado
--      técnico del código — GUEST_TECNICO_*/botón/GuestKind en
--      src/lib/auth.ts, src/ui/LoginScreen.tsx, src/ui/UserMenu.tsx, y las
--      vars correspondientes en .env local. El botón "Continuar como
--      invitado (técnico)" ya no existe.
--   b) Pendiente: Dashboard de Supabase → Authentication → Users → borrar
--      iperez@sinterk.cl (cascada sola hacia public.profiles). No bloqueaba
--      el cutover — el código ya no ofrece esa forma de entrar aunque la
--      cuenta siga existiendo en Supabase.
-- ============================================================================
