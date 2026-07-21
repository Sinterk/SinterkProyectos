-- Agrega el RUT como dato identificatorio de cada persona (no se usa para
-- login, solo para tenerlo asociado al perfil). Nullable: los perfiles ya
-- existentes no lo tienen y no hace falta pedírselo retroactivamente.
alter table public.profiles add column if not exists rut text;

-- El service_role (usado por scripts de administración, ej. alta masiva de
-- usuarios) puede bypassear RLS pero de todos modos necesita el GRANT de
-- tabla — sin esto, un script que crea la cuenta de Auth y luego intenta
-- ponerle nombre/rut en `profiles` vía `.update()` falla en silencio con
-- "permission denied for table profiles" (visto primero al crear los 3
-- técnicos de prueba, PASO en docs/CONTINUAR-BACKEND.md).
grant select, insert, update, delete on public.profiles to service_role;
