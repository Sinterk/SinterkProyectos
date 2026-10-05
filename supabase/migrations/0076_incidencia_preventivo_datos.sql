-- Ajuste a 0075 (ya corrida), pedido de Andrés (05-10-2026):
--
--   * "Responsable" e "ingeniero" son cosas distintas. El Responsable del
--     cuadrante (informe Acta Entel, por zona) NO se copia a la incidencia.
--     El ingeniero de la incidencia nace como 'Guillermo Figueroa' — solo en
--     la creación — y después es editable en la incidencia.
--   * La dirección de la incidencia es el NOMBRE DEL CUADRANTE
--     (informes_preventivo.nombre_cuadrante; si está vacío, el código del
--     cuadrante), no la dirección del informe.
--
-- Mismo trigger de 0075; solo se reemplaza la función.

create or replace function public.crear_incidencia_de_preventivo()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_inf public.informes_preventivo;
begin
  select * into v_inf from public.informes_preventivo where project_id = new.id limit 1;

  insert into public.projects (ott, area, subarea, estado, comuna, direccion, ingeniero_proyecto, preventivo_id, created_by)
  values (
    '', 'OyM', 'incidencia', 'activo', new.comuna,
    coalesce(nullif(trim(v_inf.nombre_cuadrante), ''), new.ott),
    'Guillermo Figueroa',
    new.id, new.created_by
  )
  on conflict (preventivo_id) where preventivo_id is not null do nothing;

  return new;
end;
$$;

-- Incidencias que 0075 ya creó: se corrigen solo si el valor sigue siendo la
-- copia automática (no se pisa lo que alguien haya editado a mano).
update public.projects i
   set direccion = coalesce(nullif(trim(inf.nombre_cuadrante), ''), p.ott)
  from public.projects p
  left join public.informes_preventivo inf on inf.project_id = p.id
 where i.preventivo_id = p.id
   and i.direccion is not distinct from inf.direccion;

update public.projects i
   set ingeniero_proyecto = 'Guillermo Figueroa'
  from public.projects p
  left join public.informes_preventivo inf on inf.project_id = p.id
 where i.preventivo_id = p.id
   and i.ingeniero_proyecto is not distinct from inf.responsable;
