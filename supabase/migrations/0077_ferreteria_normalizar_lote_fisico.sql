-- Normaliza el lote FÍSICO de los materiales de Ferretería (pedido de Andrés,
-- 05-10-2026).
--
-- Regla (0064/0065/0066): el físico de Ferretería vive TODO en el lote fijo
-- 'Físico' — no tiene lote distinguible. El digital, en cambio, lleva el lote
-- real de SAP (o 'SinDefinir' si la entrada no trajo ninguno, ver 0074) y NO
-- se toca acá.
--
-- Problema específico: la tarjeta de un punto en Preventivos
-- (PuntoMaterialSection) registraba el Instalado de Ferretería SIN lote, y la
-- base lo guardaba en 'SinDefinir' en vez de 'Físico' (el cliente ya se
-- corrigió, v2.32). Consecuencias: el stock físico del técnico quedaba en un
-- lote equivocado (negativo en 'SinDefinir' mientras su 'Físico' seguía
-- intacto), y la vista del proyecto mostraba el mismo material en dos filas.
-- Además hay físico de Ferretería en 'SinDefinir' en bodegas (STK, C088) que
-- no viene de ningún movimiento: se mueve igual a 'Físico'.
--
-- ===================== ANTES DE CORRER (solo lectura) =====================
-- Filas de stock con físico fuera de 'Físico' (debería ser 0 al terminar):
--   select u.nombre, m.sku, s.lote, s.cantidad_fisico, s.cantidad_digital
--     from public.stock s
--     join public.materiales m on m.id = s.material_id
--     join public.material_tipos t on t.id = m.tipo_id and lower(trim(t.nombre)) = 'ferretería'
--     join public.ubicaciones u on u.id = s.ubicacion_id
--    where s.lote <> 'Físico' and s.cantidad_fisico <> 0
--    order by u.nombre, m.sku;
-- ===========================================================================
--
-- OJO — por qué NO se reutiliza traspasar_fisico_ferreteria_a_lote_unico (0065):
-- esa función también reescribe el lote de TODOS los movimientos físicos,
-- incluidas las Entradas. Desde 0066 la Entrada de Ferretería guarda en el
-- movimiento el lote REAL de SAP (lo usan anular/corregir para revertir el
-- digital): reescribirlo a 'Físico' rompería esas reversiones. Acá el
-- movimiento solo se normaliza en los tipos que mueven físico de verdad.
--
-- Idempotente: volver a correrla no cambia nada. Cada sentencia identifica a
-- los materiales de Ferretería por el nombre del Tipo (igual que esTipoFerreteria
-- en el cliente), sin tablas temporales: funciona aunque el editor SQL corra
-- cada sentencia por separado.

-- ── stock: solo el lado físico ──────────────────────────────────────────────
-- Se acumula el físico de todo lote != 'Físico' en la fila 'Físico' de la
-- misma ubicación (si ya existía, se suma; la digital de esa fila no se toca).
insert into public.stock (ubicacion_id, material_id, lote, cantidad_fisico, cantidad_digital)
select ubicacion_id, material_id, 'Físico', sum(cantidad_fisico), 0
  from public.stock
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico' and cantidad_fisico <> 0
 group by ubicacion_id, material_id
on conflict (ubicacion_id, material_id, lote) do update
  set cantidad_fisico = stock.cantidad_fisico + excluded.cantidad_fisico;

-- Se limpia SOLO el físico de las filas de origen; su cantidad_digital queda.
update public.stock set cantidad_fisico = 0
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico' and cantidad_fisico <> 0;

-- Filas que quedaron en 0/0 ya no aportan nada.
delete from public.stock
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico' and cantidad_fisico = 0 and cantidad_digital = 0;

-- ── movimientos: solo los tipos que mueven físico por la regla del lote fijo ─
-- Excluidos a propósito: 'entrada' (guarda el lote real de SAP, ver arriba),
-- 'traslado_bodega' y los digitales (naturaleza='digital', p. ej. 'rebaja').
update public.movimientos set lote = 'Físico'
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and naturaleza = 'fisico' and lote <> 'Físico'
   and tipo in ('salida', 'instalado', 'merma', 'traslado', 'ajuste', 'solicitud');

-- ── proyecto_materiales: columnas físicas (la rebaja, digital, no se mueve) ──
-- Dos índices únicos parciales (con y sin punto), ver 0003/0065.
insert into public.proyecto_materiales (
  project_id, material_id, lote, punto_id, origen_ubicacion_id,
  cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
)
select project_id, material_id, 'Físico', punto_id, (array_agg(origen_ubicacion_id))[1],
       sum(cant_entregada), sum(cant_instalada), sum(cant_devuelta), sum(cant_rezagada), 0
  from public.proyecto_materiales
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico' and punto_id is null
   and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0)
 group by project_id, material_id, punto_id
on conflict (project_id, material_id, lote) where punto_id is null do update
  set cant_entregada = proyecto_materiales.cant_entregada + excluded.cant_entregada,
      cant_instalada = proyecto_materiales.cant_instalada + excluded.cant_instalada,
      cant_devuelta  = proyecto_materiales.cant_devuelta  + excluded.cant_devuelta,
      cant_rezagada  = proyecto_materiales.cant_rezagada  + excluded.cant_rezagada;

insert into public.proyecto_materiales (
  project_id, material_id, lote, punto_id, origen_ubicacion_id,
  cant_entregada, cant_instalada, cant_devuelta, cant_rezagada, cant_rebajada
)
select project_id, material_id, 'Físico', punto_id, (array_agg(origen_ubicacion_id))[1],
       sum(cant_entregada), sum(cant_instalada), sum(cant_devuelta), sum(cant_rezagada), 0
  from public.proyecto_materiales
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico' and punto_id is not null
   and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0)
 group by project_id, material_id, punto_id
on conflict (project_id, material_id, lote, punto_id) where punto_id is not null do update
  set cant_entregada = proyecto_materiales.cant_entregada + excluded.cant_entregada,
      cant_instalada = proyecto_materiales.cant_instalada + excluded.cant_instalada,
      cant_devuelta  = proyecto_materiales.cant_devuelta  + excluded.cant_devuelta,
      cant_rezagada  = proyecto_materiales.cant_rezagada  + excluded.cant_rezagada;

update public.proyecto_materiales
   set cant_entregada = 0, cant_instalada = 0, cant_devuelta = 0, cant_rezagada = 0
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico'
   and (cant_entregada <> 0 or cant_instalada <> 0 or cant_devuelta <> 0 or cant_rezagada <> 0);

delete from public.proyecto_materiales
 where material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería')
   and lote <> 'Físico'
   and cant_entregada = 0 and cant_instalada = 0 and cant_devuelta = 0
   and cant_rezagada = 0 and cant_rebajada = 0;

-- ── Verificación: las 3 cuentas deben dar 0 ─────────────────────────────────
select
  (select count(*) from public.stock s
     where s.material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería') and s.lote <> 'Físico' and s.cantidad_fisico <> 0)
    as stock_fisico_fuera_de_fisico,
  (select count(*) from public.movimientos m
     where m.material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería') and m.naturaleza = 'fisico' and m.lote <> 'Físico'
       and m.tipo in ('salida', 'instalado', 'merma', 'traslado', 'ajuste', 'solicitud'))
    as movimientos_fuera_de_fisico,
  (select count(*) from public.proyecto_materiales p
     where p.material_id in (select m.id from public.materiales m join public.material_tipos t on t.id = m.tipo_id where lower(trim(t.nombre)) = 'ferretería') and p.lote <> 'Físico'
       and (p.cant_entregada <> 0 or p.cant_instalada <> 0 or p.cant_devuelta <> 0 or p.cant_rezagada <> 0))
    as proyecto_materiales_fuera_de_fisico;
