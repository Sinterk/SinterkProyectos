-- Catálogo de materiales (todos los SKU en una tabla) — pedido explícito de
-- Andrés: falta una vista tipo "base de datos" con SKU/Descripción/Nombre
-- alternativo/Tipo/Proveedores. El caso real que lo motivó: el material
-- "ODF 12 FIBRAS" se conoce en terreno como "CMIC", pero `materiales.apodo`
-- (que ya existía) no tenía forma de editarse desde la app.
--
-- Tipo: lista ABIERTA (el admin agrega nuevos con "+ Nuevo tipo" desde la
-- UI) — por eso es una tabla, no un check fijo. Selección única por
-- material (tipo_id nullable = "vacío"). Los 3 tipos de cable (ADSS/ducto/
-- autosoportado) son justo los que se deben considerar para el Estado de
-- Pago (ver src/lib/ep/epRepo.ts — calcularAvanceEp ahora usa esto, en vez
-- del viejo proxy "tipo_tendido no nulo", para decidir qué instalado cuenta
-- como material de cable). Convención: cualquier tipo cuyo nombre empiece
-- con "Cable " se trata como cable para ese propósito — así un tipo nuevo
-- que el admin agregue más adelante (ej. "Cable subterráneo") funciona sin
-- tocar código, siempre que seatee ese prefijo.
create table public.material_tipos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  created_at timestamptz not null default now()
);
insert into public.material_tipos (nombre) values
  ('Ferretería'), ('Cable ADSS'), ('Cable ducto'), ('Cable autosoportado');

alter table public.material_tipos enable row level security;
create policy material_tipos_read   on public.material_tipos for select using (auth.uid() is not null);
create policy material_tipos_insert on public.material_tipos for insert with check (public.can_move_inventory());
grant select, insert on public.material_tipos to authenticated;
grant select, insert, update, delete on public.material_tipos to service_role;

alter table public.materiales add column if not exists tipo_id uuid references public.material_tipos(id);

-- Proveedores: lista FIJA por ahora (Entel/Everything/CLEH, sin "+" para
-- agregar más, a diferencia de Tipo) — selección múltiple, alcanza con un
-- array validado en vez de una tabla de unión.
alter table public.materiales add column if not exists proveedores text[] not null default '{}';
alter table public.materiales add constraint materiales_proveedores_validos
  check (proveedores <@ array['Entel','Everything','CLEH']);

-- `materiales_write` (mat_write, 0001_init.sql) ya cubre UPDATE de estas
-- columnas nuevas (can_move_inventory) — no hace falta política aparte.
