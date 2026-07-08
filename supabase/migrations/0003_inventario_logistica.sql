-- Logística de materiales por proyecto (ATT y Preventivos) + ajustes de
-- inventario para soportar el flujo solicitud→entrega→instalado→rebajado,
-- material por punto (Preventivos), y reasignación de tránsito a "preventivo"
-- al cerrar un proyecto.
--
-- No crea tablas nuevas: extiende `movimientos` y `proyecto_materiales`
-- (ya existentes desde 0001_init.sql).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- movimientos: nuevos tipos que NO tocan `stock` (solo dejan rastro/estado)
-- ---------------------------------------------------------------------------
-- 'solicitud'  → intención registrada, no mueve stock ni proyecto_materiales.cant_*
-- 'instalado'  → material ya entregado que se marca instalado; no mueve stock
--                (ya salió de bodega al entregarse); si mueve cant_instalada.
-- El resto (entrada/salida/ajuste/traslado/rebaja) sigue igual: sí tocan `stock`.
-- Se busca el nombre real del CHECK en vez de asumirlo (incluso si la
-- convención de nombres de Postgres para esto es bastante predecible).
do $$
declare
  c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.movimientos'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%tipo%entrada%salida%';
  if c_name is not null then
    execute format('alter table public.movimientos drop constraint %I', c_name);
  end if;
end $$;
alter table public.movimientos add constraint movimientos_tipo_check
  check (tipo in ('entrada','salida','ajuste','traslado','rebaja','solicitud','instalado'));

-- A qué punto de un cuadrante de Preventivos corresponde este movimiento
-- (solo aplica si se registró "desde el punto"; null = a nivel de cuadrante
-- general, o siempre null para ATT que no tiene puntos).
alter table public.movimientos add column punto_id uuid references public.puntos(id) on delete set null;
create index on public.movimientos (punto_id);

-- Informativos, no afectan cálculos de stock.
alter table public.movimientos add column proveedor text;
alter table public.movimientos add column documento text;

-- Lote sin especificar: antes '', ahora un valor legible.
alter table public.movimientos alter column lote set default 'SinDefinir';

-- ---------------------------------------------------------------------------
-- proyecto_materiales: desglose opcional por punto (Preventivos)
-- ---------------------------------------------------------------------------
alter table public.proyecto_materiales add column punto_id uuid references public.puntos(id) on delete set null;
alter table public.proyecto_materiales alter column lote set default 'SinDefinir';

-- La unique original (project_id, material_id, lote) asumía un solo punto
-- (el cuadrante general). Con punto_id nullable, Postgres no trata dos NULL
-- como duplicados, así que se reemplaza por: una unique compuesta para filas
-- CON punto (una fila por punto) + un índice parcial para la fila SIN punto
-- (una sola fila "general" por proyecto+material+lote).
-- Se busca el nombre real de la constraint en vez de asumirlo (el que le
-- puso Postgres automáticamente al crear la tabla puede no ser el esperado).
do $$
declare
  c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.proyecto_materiales'::regclass
    and contype = 'u'
    and (select array_agg(a order by a) from unnest(conkey) as a) = (
      select array_agg(attnum order by attnum)
      from pg_attribute
      where attrelid = 'public.proyecto_materiales'::regclass
        and attname in ('project_id','material_id','lote')
    );
  if c_name is not null then
    execute format('alter table public.proyecto_materiales drop constraint %I', c_name);
  end if;
end $$;

create unique index proyecto_materiales_con_punto_key
  on public.proyecto_materiales (project_id, material_id, lote, punto_id)
  where punto_id is not null;
create unique index proyecto_materiales_sin_punto_key
  on public.proyecto_materiales (project_id, material_id, lote)
  where punto_id is null;

create index on public.proyecto_materiales (punto_id);

-- ---------------------------------------------------------------------------
-- stock: mismo default de lote, por consistencia
-- ---------------------------------------------------------------------------
alter table public.stock alter column lote set default 'SinDefinir';

-- ---------------------------------------------------------------------------
-- RLS de movimientos: agregar lectura/escritura para técnico cuando el
-- movimiento es de un proyecto donde está asignado (antes solo admin/jp/log
-- podían ver movimientos; un técnico necesita ver/registrar los de SU OTT).
-- ---------------------------------------------------------------------------
drop policy if exists mov_read on public.movimientos;
drop policy if exists mov_write on public.movimientos;
create policy mov_read on public.movimientos for select
  using (public.can_move_inventory() or (project_id is not null and public.is_member(project_id)));
create policy mov_write on public.movimientos for all
  using (public.can_move_inventory() or (project_id is not null and public.is_member(project_id)))
  with check (public.can_move_inventory() or (project_id is not null and public.is_member(project_id)));
