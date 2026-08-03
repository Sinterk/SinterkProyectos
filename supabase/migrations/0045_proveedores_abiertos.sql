-- Proveedores pasa de lista fija (materiales.proveedores text[] + check) a
-- lista ABIERTA, igual que material_tipos (pedido explícito de Andrés: "que
-- se pueda agregar nuevos proveedores como en tipo"). Un CHECK no puede
-- validar contra una tabla, así que se necesita el mismo patrón de
-- catálogo + tabla de unión que ya tiene Tipo (acá además es N a N, un
-- material puede tener varios proveedores).

create table public.proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  created_at timestamptz not null default now()
);
insert into public.proveedores (nombre) values ('Entel'), ('Everything'), ('CLEH');

alter table public.proveedores enable row level security;
create policy proveedores_read   on public.proveedores for select using (auth.uid() is not null);
create policy proveedores_insert on public.proveedores for insert with check (public.can_move_inventory());
grant select, insert on public.proveedores to authenticated;
grant select, insert, update, delete on public.proveedores to service_role;

create table public.material_proveedores (
  material_id  uuid not null references public.materiales(id) on delete cascade,
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  primary key (material_id, proveedor_id)
);
alter table public.material_proveedores enable row level security;
create policy material_proveedores_read  on public.material_proveedores for select using (auth.uid() is not null);
create policy material_proveedores_write on public.material_proveedores for all
  using (public.can_move_inventory()) with check (public.can_move_inventory());
grant select, insert, update, delete on public.material_proveedores to authenticated;
grant select, insert, update, delete on public.material_proveedores to service_role;

-- Migra lo que ya se haya marcado con el array viejo (ej. la prueba real
-- hecha en SKU 51024: Everything + CLEH) antes de eliminarlo.
insert into public.material_proveedores (material_id, proveedor_id)
select m.id, p.id
from public.materiales m
cross join lateral unnest(m.proveedores) as prov(nombre)
join public.proveedores p on p.nombre = prov.nombre
on conflict do nothing;

alter table public.materiales drop constraint if exists materiales_proveedores_validos;
alter table public.materiales drop column if exists proveedores;
