-- Pedido de Andrés: poder editar desde Administración el texto de
-- "Corrección" que se autocompleta al elegir un tipo de hallazgo en
-- Preventivos, por si más adelante llega feedback y hay que ajustarlo — sin
-- que eso implique un deploy de código.
--
-- Hasta ahora `CORRECCIONES_POR_HALLAZGO` era un objeto vacío hardcodeado en
-- PuntoCard.tsx, pendiente de que Andrés pasara el texto real de cada
-- hallazgo. Llegó esa lista (22 hallazgos, los últimos 2 sin texto
-- definido todavía) y en vez de volver a hardcodearla, se guarda en una
-- tabla editable.
--
-- `hallazgo` es la clave (el mismo texto exacto que usa el <select> en
-- PuntoCard — no hay tabla de catálogo de hallazgos, esa lista sigue siendo
-- un array fijo en el cliente, en `src/modules/preventivos/hallazgos.ts`).
-- Si algún día se agrega un hallazgo nuevo en el código sin crear su fila
-- acá, el lookup simplemente no encuentra nada y el campo Corrección queda
-- vacío — mismo comportamiento que tenía el objeto hardcodeado antes.
create table public.correcciones_hallazgo (
  hallazgo   text primary key,
  correccion text not null default '',
  updated_at timestamptz not null default now()
);
create trigger correcciones_hallazgo_updated before update on public.correcciones_hallazgo
  for each row execute function public.set_updated_at();

alter table public.correcciones_hallazgo enable row level security;
-- Lectura: cualquier usuario logueado — técnicos y jp la necesitan para el
-- autocompletado al elegir hallazgo, no solo admin.
create policy ch_read on public.correcciones_hallazgo for select using (auth.uid() is not null);
-- Escritura: solo admin, como el resto de Administración.
create policy ch_write on public.correcciones_hallazgo for all using (public.is_admin()) with check (public.is_admin());

-- Siembra con el texto que pasó Andrés (20 de los 22 hallazgos; los otros 2
-- quedan sin fila — mismo efecto que dejarlos vacíos, y así el editor de
-- Administración no tiene que decidir entre "vacío real" y "sin sembrar").
insert into public.correcciones_hallazgo (hallazgo, correccion) values
  ('Altura de cable Cruce de calles "4,5 mts"', 'Se regula altura de cable y normaliza tendido.'),
  ('Atenuación fuera de norma sin afectar servicio', 'Se corrige atenuación.'),
  ('CTO sin potencia y sin clientes', 'Se regula distribución.'),
  ('Mufa en el suelo', 'Se regula tendido Entel.'),
  ('Cámara sin tapa', 'Se instala tapa regula estado de cámara.'),
  ('Cámara Abierta / Sin soldar', 'Se cierra/solda tapa y regula cámara.'),
  ('Mufa o cable colgando en cruce de calle', 'Se regula tendido Entel.'),
  ('Mufa en mal estado', 'Se regula estado de mufa.'),
  ('Gestión ante quien corresponda por el Estado Postes/ postación dañada', 'Se escala estado de poste.'),
  ('Baja distancia a Red BT/AT', 'Se regula tendido.'),
  ('Bajada Lateral sin fleje', 'Se instala fleje y regula empostación.'),
  ('CTO con tapa abierta o sin tapa', 'Se cierra tapa / instala tapa y regula CTO.'),
  ('Falla en estructura o sellos de cámara', 'Se regula estado de cámara.'),
  ('Bandeja de Emergencia / Mufa sin Cúpula', 'Se regula estado de bandeja de emergencia / mufa'),
  ('Altura Cable Vano sin riesgo', 'Se regula altura de tendido.'),
  ('Vano sobrecargado', 'Se regula Vano.'),
  ('Rotulado de Mufas, cables, gabinetes, DC', 'Se rotula mufa/cable/gabinete/DC.'),
  ('Rotulado de CTO', 'Se rotula CTO.'),
  ('Entrada sin sello cable / Mufa', 'Se instala sello de cable/mufa y regula tendido.'),
  ('Falta cruceta o Cruceta Dañada', 'Se instala cruceta / repara cruceta y regula tendido.');
