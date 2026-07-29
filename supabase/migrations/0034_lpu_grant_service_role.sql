-- Mismo gotcha que 0017_profiles_rut.sql: `service_role` bypasea RLS pero
-- de todos modos necesita el GRANT de tabla explícito en este proyecto — sin
-- esto, scripts/importar-lpu.mjs falla con "permission denied for table
-- lpu_codigos" al intentar leer/escribir con la service role key.

grant select, insert, update, delete on public.lpu_codigos       to service_role;
grant select, insert, update, delete on public.lpu_precios_zona  to service_role;
grant select, insert, update, delete on public.lpu_ito_servicios to service_role;
grant select, insert, update, delete on public.lpu_material_map  to service_role;
grant select, insert, update, delete on public.lpu_tendido_map   to service_role;
grant select, insert, update, delete on public.ep_informes       to service_role;
grant select, insert, update, delete on public.ep_lineas         to service_role;
