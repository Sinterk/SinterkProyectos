-- Andrés: agregar "Gabinete sin tapa" como hallazgo 23 hizo evidente que la
-- lista de tipos de hallazgo era un array fijo en el cliente
-- (src/modules/preventivos/hallazgos.ts) — cualquier hallazgo nuevo
-- necesitaba un deploy de código. Pedido: poder agregarlos desde
-- Administración, igual que ya se puede editar el texto de "Corrección"
-- (ver 0062_correcciones_hallazgo.sql).
--
-- En vez de crear una tabla de catálogo aparte (que quedaría desincronizada
-- de `correcciones_hallazgo`, ambas keyeadas por el mismo texto), esta
-- migración hace que `correcciones_hallazgo` sea también el catálogo: se le
-- agrega `orden` (para el número que se ve en el selector, "N. hallazgo" —
-- mismo criterio que ya usaba el array) y `activo` (para poder sacar un
-- hallazgo del selector sin borrarlo — los puntos ya registrados con ese
-- texto lo necesitan seguir mostrando).
--
-- Se respalda la lista completa (22 hallazgos + el 23 nuevo) con su orden
-- histórico, sin pisar el texto de Corrección que ya esté guardado —
-- `on conflict ... do update set orden = excluded.orden` deja `correccion`
-- intacta en las filas que ya existían.
--
-- OJO — esto NO alcanza al informe ACTA de Entel: esa plantilla tiene un
-- formato oficial fijo (22+1 filas ya impresas en el .xlsx, ver
-- generarInformeEntel.ts y templateEntelB64.ts) y solo reconoce los 23
-- hallazgos que ya tiene mapeados en `HALLAZGO_PWA`. Un hallazgo agregado
-- acá desde Administración aparece en el selector de Preventivos y en el
-- informe Levantamiento (que no depende de una lista fija), pero NO se
-- contará en la tabla resumen del Acta Entel hasta que alguien también
-- agregue esa fila a la plantilla — eso sigue siendo un cambio de código,
-- porque el formato es de Entel, no nuestro.

alter table public.correcciones_hallazgo add column if not exists orden integer;
alter table public.correcciones_hallazgo add column if not exists activo boolean not null default true;

insert into public.correcciones_hallazgo (hallazgo, correccion, orden) values
  ('Altura de cable Cruce de calles "4,5 mts"', '', 1),
  ('Atenuación fuera de norma sin afectar servicio', '', 2),
  ('CTO sin potencia y sin clientes', '', 3),
  ('Mufa en el suelo', '', 4),
  ('Cámara sin tapa', '', 5),
  ('Cámara Abierta / Sin soldar', '', 6),
  ('Mufa o cable colgando en cruce de calle', '', 7),
  ('Mufa en mal estado', '', 8),
  ('Gestión ante quien corresponda por el Estado Postes/ postación dañada', '', 9),
  ('Baja distancia a Red BT/AT', '', 10),
  ('Bajada Lateral sin fleje', '', 11),
  ('CTO con tapa abierta o sin tapa', '', 12),
  ('Falla en estructura o sellos de cámara', '', 13),
  ('Bandeja de Emergencia / Mufa sin Cúpula', '', 14),
  ('Altura Cable Vano sin riesgo', '', 15),
  ('Vano sobrecargado', '', 16),
  ('Rotulado de Mufas, cables, gabinetes, DC', '', 17),
  ('Rotulado de CTO', '', 18),
  ('Entrada sin sello cable / Mufa', '', 19),
  ('Falta cruceta o Cruceta Dañada', '', 20),
  ('Falta Planimetria', '', 21),
  ('CTO en condición insegura o no autorizada', '', 22),
  ('Gabinete sin tapa', '', 23)
on conflict (hallazgo) do update set orden = excluded.orden;

-- Todo lo sembrado arriba ya tiene orden — de acá en adelante lo exige la
-- app en cada insert nuevo (siguiente número = max(orden)+1).
alter table public.correcciones_hallazgo alter column orden set not null;
