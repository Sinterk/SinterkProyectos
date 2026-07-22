-- Cargo/puesto de la persona (ej. "Técnico Ayudante", "Jefe de Proyectos"),
-- tal como viene en la planilla de personal. Nullable, solo informativo — no
-- se usa para permisos (eso lo sigue decidiendo `rol`).
alter table public.profiles add column if not exists cargo text;
