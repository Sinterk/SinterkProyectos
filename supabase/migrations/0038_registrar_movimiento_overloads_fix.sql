-- Dos bugs reales encontrados al verificar 0037 contra la BD real (ninguno
-- introducido por 0037 — ambos preexistían, 0037 solo los hizo visibles al
-- forzar un recompilado fresco de registrar_movimiento):
--
-- 1. Cada migración que le agregó un parámetro nuevo a registrar_movimiento
--    (0020 agregó p_area, 0037 agregó p_ubicacion_bodega_destino_id) usó
--    `create or replace function` — pero en Postgres la firma de una
--    función incluye la LISTA de parámetros, así que agregar uno nuevo NO
--    reemplaza la versión anterior: crea una función SOBRECARGADA aparte.
--    Convivían en la BD 3 versiones: (A) 12 parámetros sin p_area — de
--    0005/0007; (B) 13 parámetros con p_area — de 0020/0022/0025;
--    (C) 14 parámetros (+ p_ubicacion_bodega_destino_id) — de 0037, la
--    vigente. Nunca se notó porque el cliente (`inventarioRepo.ts`) siempre
--    manda el set COMPLETO de parámetros de la versión vigente, lo que
--    basta para que PostgREST elija sin ambigüedad — pero un llamado con un
--    subconjunto (confirmado con un script de verificación) recibía
--    `PGRST203 Could not choose the best candidate function`.
--
-- 2. Mismo problema, un nivel más adentro: 0025 le agregó
--    `p_permitir_negativo` a `adjust_stock` (de 5 a 6 parámetros), sin
--    dropear la versión de 5 — quedaron 2 versiones conviviendo. Todas las
--    ramas de `registrar_movimiento` llaman a `adjust_stock` con 5
--    argumentos posicionales (ej. `adjust_stock(..., p_cantidad, 0)`), lo
--    que a partir de 0025 quedó ambiguo entre "la de 5, calza exacto" y
--    "la de 6, usa el default" — confirmado en vivo: una Entrada de prueba
--    (ya con (C) resuelta sin ambigüedad) falló con
--    `42725 function public.adjust_stock(uuid, uuid, text, numeric,
--    integer) is not unique`. Este bug ya afectaba a TODOS los tipos de
--    movimiento desde que 0025 se corrió, no solo al nuevo traspaso — según
--    la sesión de Postgres, puede haber seguido "funcionando" en conexiones
--    que ya tenían el plan cacheado desde antes de 0025, lo que explicaría
--    por qué no se notó en las verificaciones previas.
--
-- Se eliminan ambas versiones viejas, dejando solo la vigente en cada caso.

drop function if exists public.registrar_movimiento(
  text, uuid, numeric, text, timestamptz, text, uuid, text, text, uuid, uuid, uuid
);

drop function if exists public.registrar_movimiento(
  text, uuid, numeric, text, timestamptz, text, uuid, text, text, uuid, uuid, uuid, text
);

drop function if exists public.adjust_stock(uuid, uuid, text, numeric, numeric);
