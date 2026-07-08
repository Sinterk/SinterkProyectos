-- Renombra el tipo de ubicación 'camioneta' → 'tecnico': el concepto es
-- "esta ubicación es de un técnico" (dónde lleva su material), sin atarlo a
-- la idea literal de un vehículo. `ubicaciones` está vacía todavía (no hay
-- filas que migrar), así que es un cambio de esquema limpio.

do $$
declare
  c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.ubicaciones'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%tipo%bodega%camioneta%';
  if c_name is not null then
    execute format('alter table public.ubicaciones drop constraint %I', c_name);
  end if;
end $$;

update public.ubicaciones set tipo = 'tecnico' where tipo = 'camioneta';

alter table public.ubicaciones add constraint ubicaciones_tipo_check
  check (tipo in ('bodega','tecnico'));
