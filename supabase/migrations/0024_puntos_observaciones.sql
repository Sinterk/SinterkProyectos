-- Comentarios por punto (ej. "no encontré el material X en bodega/equipo"):
-- reusa la misma tabla `observaciones` de la pestaña Logística, con un
-- `punto_id` opcional — null sigue siendo un comentario general del proyecto
-- (comportamiento actual, sin cambios), con punto_id es un comentario de ESE
-- punto específico. Requiere que `puntos.id` ya sea estable entre guardados
-- (ver fix de replacePuntos en preventivoRepo.ts) para que la referencia no
-- se pierda en el siguiente autoguardado del cuadrante.

alter table public.observaciones add column punto_id uuid references public.puntos(id) on delete set null;
