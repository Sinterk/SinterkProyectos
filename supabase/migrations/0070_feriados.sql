-- Calendario de OTTs (ATT): pedido de Andrés — vista de mes que resalta los
-- días con OTTs abiertas y distingue fines de semana/feriados. Necesita una
-- tabla de feriados para pintarlos de azul junto con los fines de semana.
--
-- Catálogo abierto (fecha + nombre) editable desde la propia vista de
-- Calendario (no en Catálogo de Inventario — son conceptos sin relación,
-- nadie que gestione OTTs va a buscar feriados ahí). Se siembra con los
-- feriados chilenos de FECHA FIJA 2025-2028 — los movibles (Viernes/Sábado
-- Santo, Corpus Christi, San Pedro y San Pablo, Encuentro de Dos Mundos —
-- estos dos últimos a veces se corren a lunes por ley de fin de semana
-- largo) NO quedan cubiertos automáticamente: se agregan a mano desde la
-- vista, igual que cualquier feriado nuevo de años futuros.
create table public.feriados (
  fecha      date primary key,
  nombre     text not null,
  created_at timestamptz not null default now()
);

alter table public.feriados enable row level security;
-- Lectura: cualquier usuario logueado (pinta el calendario para cualquier rol).
create policy feriados_read  on public.feriados for select using (auth.uid() is not null);
-- Escritura: admin/jp — mismo criterio que gestionar proyectos ATT (is_jp_or_admin, 0001_init.sql).
create policy feriados_write on public.feriados for all
  using (public.is_jp_or_admin()) with check (public.is_jp_or_admin());
grant select, insert, update, delete on public.feriados to authenticated;
grant select, insert, update, delete on public.feriados to service_role;

insert into public.feriados (fecha, nombre) values
  ('2025-01-01', 'Año Nuevo'),
  ('2025-05-01', 'Día del Trabajo'),
  ('2025-05-21', 'Día de las Glorias Navales'),
  ('2025-07-16', 'Virgen del Carmen'),
  ('2025-08-15', 'Asunción de la Virgen'),
  ('2025-09-18', 'Independencia Nacional'),
  ('2025-09-19', 'Glorias del Ejército'),
  ('2025-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2025-11-01', 'Día de Todos los Santos'),
  ('2025-12-08', 'Inmaculada Concepción'),
  ('2025-12-25', 'Navidad'),

  ('2026-01-01', 'Año Nuevo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-21', 'Día de las Glorias Navales'),
  ('2026-07-16', 'Virgen del Carmen'),
  ('2026-08-15', 'Asunción de la Virgen'),
  ('2026-09-18', 'Independencia Nacional'),
  ('2026-09-19', 'Glorias del Ejército'),
  ('2026-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2026-11-01', 'Día de Todos los Santos'),
  ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-25', 'Navidad'),

  ('2027-01-01', 'Año Nuevo'),
  ('2027-05-01', 'Día del Trabajo'),
  ('2027-05-21', 'Día de las Glorias Navales'),
  ('2027-07-16', 'Virgen del Carmen'),
  ('2027-08-15', 'Asunción de la Virgen'),
  ('2027-09-18', 'Independencia Nacional'),
  ('2027-09-19', 'Glorias del Ejército'),
  ('2027-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2027-11-01', 'Día de Todos los Santos'),
  ('2027-12-08', 'Inmaculada Concepción'),
  ('2027-12-25', 'Navidad'),

  ('2028-01-01', 'Año Nuevo'),
  ('2028-05-01', 'Día del Trabajo'),
  ('2028-05-21', 'Día de las Glorias Navales'),
  ('2028-07-16', 'Virgen del Carmen'),
  ('2028-08-15', 'Asunción de la Virgen'),
  ('2028-09-18', 'Independencia Nacional'),
  ('2028-09-19', 'Glorias del Ejército'),
  ('2028-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2028-11-01', 'Día de Todos los Santos'),
  ('2028-12-08', 'Inmaculada Concepción'),
  ('2028-12-25', 'Navidad')
on conflict (fecha) do nothing;
