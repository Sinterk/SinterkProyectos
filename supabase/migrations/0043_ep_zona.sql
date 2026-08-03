-- La "Zona LPU" (13 zonas de precio, ver lpu_precios_zona) se elige en la
-- pantalla de EP independiente de región/comuna del formulario ATT (texto
-- libre, sin estandarizar — ver diseño en docs/CONTINUAR-BACKEND.md punto 19).
-- Faltaba dónde guardarla: se agrega acá para que quede por OTT, no haya que
-- re-elegirla cada vez que se entra a la pantalla.

alter table public.ep_informes add column if not exists zona text;
