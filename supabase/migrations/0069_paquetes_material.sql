-- Andrés: "hay un tipo de cruceta, que su instalación incluye 6 materiales.
-- Agrega una sección en catálogo de ingresar materiales en 'paquete', cosa
-- que al buscar material para ingresar, la descripción sea el paquete
-- completo, y con esta se ingresen todos los sku asociados."
--
-- Un "paquete" es solo un nombre + un conjunto de SKUs (sin cantidad por
-- SKU: al elegirlo, cada SKU se agrega sin cantidad — el usuario la
-- completa a mano por línea, igual que si los hubiera agregado uno por
-- uno). Mismo patrón de catálogo abierto que material_tipos/proveedores
-- (0044/0045): tabla + tabla de unión, RLS de lectura para cualquier
-- logueado, escritura para quien puede mover inventario (admin/jp/log).
create table public.paquetes_material (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  created_at timestamptz not null default now()
);

alter table public.paquetes_material enable row level security;
create policy paquetes_material_read  on public.paquetes_material for select using (auth.uid() is not null);
create policy paquetes_material_write on public.paquetes_material for all
  using (public.can_move_inventory()) with check (public.can_move_inventory());
grant select, insert, update, delete on public.paquetes_material to authenticated;
grant select, insert, update, delete on public.paquetes_material to service_role;

create table public.paquete_material_items (
  paquete_id  uuid not null references public.paquetes_material(id) on delete cascade,
  material_id uuid not null references public.materiales(id) on delete cascade,
  primary key (paquete_id, material_id)
);
alter table public.paquete_material_items enable row level security;
create policy paquete_material_items_read  on public.paquete_material_items for select using (auth.uid() is not null);
create policy paquete_material_items_write on public.paquete_material_items for all
  using (public.can_move_inventory()) with check (public.can_move_inventory());
grant select, insert, update, delete on public.paquete_material_items to authenticated;
grant select, insert, update, delete on public.paquete_material_items to service_role;
