-- Columna de observación libre por material (ej. "viene sin marcar de
-- fábrica"), editable inline desde la pestaña Bodega igual que stock_minimo.
-- Misma política de escritura que el resto de `materiales` (mat_write,
-- can_move_inventory(): admin/jp/log) — no hace falta política nueva.

alter table public.materiales add column if not exists comentario text;
