# Continuar — Migración a backend Supabase

> Documento de retomada. Estado al pausar: rama `backend-supabase`, **sin desplegar**.

## Contexto del proyecto
- **TelecomCatalog**: PWA React 18 + Vite + TS + Tailwind + Zustand + idb.
- Repo `github.com/Sinterk/TelecomCatalog`. Deploy: push a `main` → `.github/workflows/deploy.yml` → GitHub Pages (`https://sinterk.github.io/TelecomCatalog/`). Versión visible `vX.YY` en el header (`APP_VERSION` en `vite.config.ts`).
- Módulos (registry pattern): `att` (informes OTT/ATT) y `preventivos`. Generadores de informe: `src/modules/att/utils/generarInformeAtt.ts` (DOCX) y `generarPdfAtt.ts` (PDF con jsPDF lazy-loaded).

## Objetivo: pasar de cliente-only a backend Supabase
Tres metas: (1) data online (técnicos suben directo), (2) usuarios con roles, (3) inventario por proyecto (stock físico/digital + movimientos).

- **Proyecto Supabase**: `https://xwawplezarrfonuyaaxu.supabase.co`
- **Publishable (anon) key**: en `.env` / `.env.production` (`VITE_SUPABASE_ANON_KEY`). Es pública por diseño; la RLS es el filtro real.
- **Esquema**: `supabase/migrations/0001_init.sql` (ATT + base) y `0002_preventivos.sql` (Preventivos) — AMBOS ya ejecutados en Supabase, más los `GRANT` a anon/authenticated y `alter table projects add column jefe_proyecto`. RLS verificada funcionando.

### Roles y acceso (RLS)
`admin` (todo) · `jp` (ve/edita TODOS los proyectos, asigna técnicos) · `tecnico` (solo proyectos donde está en `project_members`) · `log` (mueve inventario). Solo el admin crea usuarios (no hay registro público). Crear proyectos = solo jp/admin.

### Modelo de datos (resumen)
- `projects` (maestro genérico por área; 1 informe por proyecto; cierre + versionado por copia) — compartido por ATT y Preventivos, cada uno con su propio hijo 1:1:
  - **ATT** (`area='ATT'`): `informes` + `tramos`/`hitos`/`fotos`.
  - **Preventivos** (`area='OyM'`): `informes_preventivo` + `puntos`. `projects.ott`/`comuna` se reutilizan como identificador visible/comuna del cuadrante (nombres de columna heredados de cuando solo existía ATT).
- Inventario: `ubicaciones` (bodega/camioneta), `materiales` (SKU único, apodo, controla_lote_fisico), `stock` (dual: cantidad_fisico + cantidad_digital, por ubicacion+material+lote), `movimientos` (naturaleza fisico/digital), `conteos`+`conteo_lineas`, `eventos_inventario`, `proyecto_materiales` (entregado/instalado/devuelto/rezagado/rebajado; tránsito calculado).

## Estado actual (rama `backend-supabase`, NO en producción)
Rama en **v0.54**. **No se hizo push a `main`** para no publicar el gate de login sin datos conectados ni usuarios (producción sigue en v0.52, sin login). Nota de versiones: `backend-supabase` (v0.54) va **por delante** de `main` (v0.52, los dos fixes de fotos de preventivos ya vivos); se reconcilia en el cutover.

Ya hecho:
- `src/lib/supabaseClient.ts` — cliente supabase-js leyendo `VITE_SUPABASE_*`.
- `src/lib/auth.ts` — store Zustand de auth (sesión + perfil/rol, `signIn`/`signOut`).
- `src/ui/LoginScreen.tsx` — login real email/contraseña.
- `src/App.tsx` — gatea por sesión; bloquea cuentas desactivadas.
- `.env.production` versionado; build de producción pasa.
- **PASO 1 — Capa de datos** `src/modules/att/data/attRepo.ts`: CRUD `list`/`load`/`save`/`remove` que mapea `AttRecord` ↔ `projects` + `informes` + `tramos`/`hitos`/`fotos`. `save` = upsert (uuid→update; id de cliente→insert y devuelve el uuid canónico); lectura se arma sobre `emptyAttRecord`; jsonb directo para `coords`/`ingresoRed`/`infraestructura`; hijos por delete+insert con `orden`. Se añadió `storagePath?` a `FotoEntry` (`types.ts`) como seam para el paso 2 (`save` solo persiste fotos que ya tengan `storagePath`).
- **Modo invitado** (cuenta compartida, rol jp): `signInAsGuest`/`isGuest`/`guestEnabled` en `auth.ts`; botón "Continuar como invitado" en `LoginScreen`; menú de usuario en el header (`src/ui/UserMenu.tsx`) con correo, rol, mostrar contraseña (solo invitado), cambiar contraseña (usuario real: verifica la actual + `supabase.auth.updateUser`) y cerrar sesión. Requiere `VITE_GUEST_EMAIL`/`VITE_GUEST_PASSWORD` en `.env`. **OJO**: al ser `VITE_*` la contraseña queda embebida en el bundle → NO desplegar a producción con la cuenta invitado activa.
- **Cuentas en Supabase**: admin `abarahona@sinterk.cl` + invitado `abarahona.sinterk@gmail.com` (rol jp). Login + invitado probados de punta a punta contra la RLS (list/insert/lectura anidada OK). No recrearlas.
- **PASO 2 — Fotos → Storage** `src/modules/att/data/photoStorage.ts`: `uploadPhotoObject`/`getSignedUrl(s)`/`removePhotoObjects` (bajo nivel) + `uploadRecordPhotos(record)` (sube blobs pendientes de IndexedDB al bucket `fotos`, ruta `att/{blobId}.jpg`, rellena `storagePath`). Lectura: `src/modules/att/hooks/useResolveAttPhotoUrls.ts` resuelve signed URLs en lote para fotos con `storagePath` sin `previewUrl` (espejo online de `useRestoreAttPhotos`, conviven sin pisarse). Probado extremo a extremo (upload, signed URL, fetch, remove) contra el bucket real.
- **PASO 3 — Store online-first** `src/modules/att/store.ts`: `createNew`/edición de campos siguen 100% locales e instantáneas (sin red en cada tecla); `useAttAutosave` (nuevo hook) debounce 800ms → `uploadRecordPhotos` + `attRepo.save`. Nuevas acciones del store: `syncList()`/`syncOne(id)` (traen de Supabase y fusionan en cache — solo si el servidor es más nuevo que lo local, para no pisar tipeo en curso) y `remove(id)` ahora async y **role-aware**: admin → `attRepo.remove` (DELETE real); jp/invitado → `attRepo.close` (nuevo método: `estado='cerrado'`+`fecha_cierre`, no borra). `attRepo.list()` ahora filtra `estado='activo'`. `attRepo.remove`/`close` verifican filas afectadas (`.select()` tras la mutación) y lanzan error explícito si la RLS bloqueó la operación (0 filas), en vez de fallar en silencio.
  - **Promoción de id** (borrador local nanoid → uuid del servidor tras el primer guardado): el store expone `rekey(oldId, saved)`. Cuidado detectado y corregido: justo después del rekey, el id viejo desaparece del store un instante antes de que la navegación a la URL nueva se confirme; el efecto de Editor que redirige a Home "si no hay record para este id" puede dispararse en esa ventana y ganarle la carrera al `navigate` correcto. Se resolvió con un ref `hadRecord` en `Editor.tsx`: solo redirige a Home si el record **nunca** existió para ese id (deep-link roto), no cuando ya existió y desapareció por la promoción.
  - **`syncedAt`** (nuevo, en el store): registra el último `updatedAt` que vino del servidor (por `syncOne`/`syncList`/`rekey`), para que `useAttAutosave` no confunda "el store se refrescó desde Supabase" con "el usuario editó algo". Sin esto, cada vez que se abre o recarga un informe se disparaba un guardado espurio (delete+insert de tramos/fotos) sin que nadie tocara nada.
  - Verificado en el navegador: crear→autoguardar→promoción de id→URL correcta; edición en caliente de un registro ya-uuid; subida de `fotoAerea` y de foto de galería (con inserción real en `fotos`); resolución de signed URL tras reload; `remove()` como invitado (rol jp) confirmado en la BD como **cierre** (`estado='cerrado'`, `fecha_cierre` hoy), no borrado.
- **PASO 4 — Migración de borradores locales**: se extrajo el guardado real a una acción del store, `persistToServer(id)` (sube fotos pendientes + `attRepo.save` + `rekey` si corresponde), que ahora usan tanto `useAttAutosave` como la migración — un solo camino para "persistir esto en Supabase", sin duplicar lógica. `hasPendingSync(record)` (exportado de `store.ts`) marca un informe como pendiente si su id sigue siendo nanoid (nunca llegó al servidor) o si le quedó una foto con `blobId` sin `storagePath` (subida que no llegó a completarse). En `Home.tsx`, si hay pendientes aparece un aviso ("⚠️ N informe(s) sin sincronizar" + botón "Sincronizar ahora") que los sube uno por uno vía `persistToServer`; los que fallan se listan con su error y un botón "Reintentar" individual, sin bloquear a los demás. Probado en el navegador: se creó un borrador sin tocar ningún campo (para simular uno que quedó huérfano de antes del cutover), el aviso lo detectó, y "Sincronizar ahora" lo persistió con uuid real confirmado en la BD.
- **PASO 5 — Pantalla de admin** `src/ui/AdminScreen.tsx` (ruta `/admin`, enlace "⚙️ Administración" en `UserMenu` solo si `rol==='admin'`; la propia pantalla también verifica el rol y muestra un candado si no — doble cerrojo, además de la RLS). Capa de datos en `src/lib/adminRepo.ts`. Dos secciones:
  - **Usuarios**: lista todos los `profiles` (RLS `profiles_admin`: solo admin lee/edita todos); por fila se edita nombre/rol/área/activo y se guarda con `adminRepo.updateProfile`. **La creación del login (`auth.users`) sigue siendo manual en el dashboard de Supabase** — decisión deliberada: crearlo desde la app requeriría la `service_role key`, que no puede exponerse en el bundle del cliente sin backend nuevo. El trigger `handle_new_user` ya crea el `profiles` automáticamente (rol `tecnico` por defecto) al dar de alta el login; la pantalla es donde se ajusta ese rol/área después.
  - **Equipo por proyecto**: selector de proyecto ATT activo + checklist de técnicos/logística para asignar/quitar de `project_members` (`adminRepo.addMember`/`removeMember`), que es lo que la RLS usa (`is_member`) para decidir qué ve un `tecnico`.
  - Probado por el usuario con la cuenta admin real: encontró que el admin podía quitarse su propio rol/desactivarse. **Fix**: en `UserRow`, si la fila es la del usuario logueado (`session.user.id`), los controles de rol y activo quedan deshabilitados con una nota explicativa. Es un candado de UI, no de RLS — un admin decidido podría bypasear vía API directa; si se quiere blindar del todo, falta un trigger en Postgres. **Confirmado arreglado por el usuario.**
  - Al probar "Equipo por proyecto" no había ningún perfil con rol técnico/log todavía (mensaje "No hay técnicos ni logística registrados todavía") — es el comportamiento esperado en un sistema nuevo, no un bug; queda por probar en cuanto exista al menos un usuario técnico real. Ahora el selector de proyecto incluye tanto ATT como Preventivos (`[ATT]`/`[Preventivo]` + código + comuna/nombre).
- **Filtro de estado + buscador en Home** (ATT y Preventivos): pedido tras probar admin — antes solo se veían los activos, sin forma de ver cerrados ni buscar. `attRepo.list(opts?: {estado})`/`preventivoRepo.list(opts?: {estado})` aceptan `'activo'|'cerrado'|'todos'` (default `'activo'`, sin romper a `syncList`/demás llamadores existentes). `AttRecord`/`Preventivo` ganaron `estado`/`fechaCierre` (solo lectura desde el Editor — `recordToProjectRow` los excluye explícitamente del payload de `save()`, para que un guardado normal nunca pueda reabrir/cerrar un proyecto por accidente). En cada `Home.tsx`: selector Activos/Cerrados/Todos + buscador; cerrados/todos se piden aparte del store (que solo cachea activos editables) y se re-consultan al cambiar filtro o borrar/cerrar algo. Tarjeta muestra badge "🔒 Cerrado *fecha*" cuando corresponde. **Confirmado por el usuario en el navegador** (ATT); Preventivos verificado en esta sesión (ver abajo).
- **PASO 6 — Migración de Preventivos a Supabase**: mismo patrón completo que ATT (pasos 1-4), aplicado a este módulo.
  - **Esquema nuevo** `supabase/migrations/0002_preventivos.sql`: reutiliza `projects` (`area='OyM'`) para heredar roles/RLS/estado-cierre/`project_members` ya construidos — no duplica esa infraestructura. Tablas nuevas: `informes_preventivo` (1:1 con `projects`; grupo/fecha/semana/semestre/zona/responsable/foto del plano) y `puntos` (hijos; nombre/descripción/dirección/corrección/hallazgo/resuelto + 3 fotos: levantamiento/antes/después). RLS calcada de ATT (`is_jp_or_admin()`/`is_member()`, con un `can_edit_informe_prev()` nuevo espejo de `can_edit_informe()`). Ejecutado y verificado por el usuario en el SQL Editor.
  - **Refactor previo, compartido con ATT** (para no duplicar código entre módulos): `src/lib/photoStorage.ts` (subir/firmar/borrar en el bucket `fotos`, genérico) y `src/lib/projectLifecycle.ts` (`removeProject`/`closeProject`, ambos operan sobre `projects` sin importar el área). `att/data/photoStorage.ts` y `att/data/attRepo.ts` se actualizaron para consumir estos compartidos en vez de tener su propia copia.
  - **Capa de datos** `src/modules/preventivos/data/preventivoRepo.ts` (list/load/save + remove/close reexportados del lifecycle compartido) y `data/photoStorage.ts` (`uploadRecordPhotos` recorre `cuadrante.fotoPlano` + las 3 fotos de cada punto; ruta `preventivos/{blobId}.jpg`).
  - **Store online-first** `src/modules/preventivos/store.ts`: mismo diseño que ATT (`persistToServer`, `syncList`/`syncOne`, `rekey`, `syncedAt`, `hasPendingSync`, `remove` role-aware). Diferencia clave: como las fotos no son un array plano sino `fotoPlano` + 3 slots nombrados por punto, el merge servidor↔local (`mergeFromServer`/`rekey`) indexa **todas** las fotos del record en un `Map` por `storagePath` (`collectFotosByPath`) en vez de buscar por posición, para no depender de que los puntos conserven el mismo orden/índice.
  - **Bug encontrado y corregido antes de que llegara a producción** (no en el navegador, por inspección de código): `useRestorePhotoPreviews.ts` (restaura previews desde IndexedDB al montar) usaba `updateCuadrante`/`setFoto`, que sí marcan `touch()` (bump de `updatedAt`). Con autoguardado real eso habría disparado un guardado espurio solo por abrir el Editor — el mismo bug que ya se había encontrado y arreglado en ATT (`setFotoPreview`/`setFotoAereaPreview`). Se agregaron setters gemelos sin `touch()`: `setFotoPlanoPreview`/`setPuntoFotoPreview`, y se migró el hook a usarlos.
  - Hooks nuevos: `usePreventivoAutosave.ts` (idéntico a `useAttAutosave.ts`, sin partes específicas de ATT) y `useResolvePhotoUrls.ts` (resuelve signed URLs en lote, recorriendo plano + puntos).
  - `Editor.tsx`: mismo fix de condición de carrera que ATT (`hadRecord` ref) para la promoción de id nanoid→uuid, `syncOne` al montar, indicador de guardado con estado de error + reintentar.
  - **Verificado en el navegador de punta a punta**: crear levantamiento → autoguardado → promoción de id (sin la carrera, ya con el fix desde el diseño) → URL correcta; agregar punto + foto → subida a Storage (`preventivos/{blobId}.jpg`) confirmada + fila en `puntos` con el path correcto; reload/deep-link → `syncOne` + signed URL resueltas → **sin guardado espurio** (mismo chequeo que en ATT); filtro Activos/Cerrados/Todos con datos reales; `remove()` como invitado (jp) confirmado en la BD como cierre, no borrado.

## Gotchas importantes
- **Publishable key `sb_publishable_` NO es JWT**: para probar la REST API anónima con curl/PowerShell, mandar SOLO el header `apikey` (NO `Authorization: Bearer`, da 401).
- La migración usa `set check_function_bodies = off` para permitir que las funciones referencien tablas creadas más abajo.
- Los roles anon/authenticated necesitan `GRANT` (ya aplicados; incluidos en la migración para instalaciones nuevas).
- **`.env` es gitignored** — recrear en cada PC (ver setup abajo).
- **Primer admin**: Supabase → Authentication → Add user (marcar *Auto Confirm*), luego `update public.profiles set rol='admin', nombre='...' where email='...';`
- ~~`attRepo.remove()` no-op silencioso para jp/invitado~~ **RESUELTO en paso 3**: ver "Store online-first" arriba (`close()` + detección de 0 filas afectadas).
- **`projects.jefe_proyecto` (texto) nunca se creó en la BD real**, pese a que el commit `a03672a` y este doc decían que sí: ese commit solo tocó el `CREATE TABLE` de `0001_init.sql` (referencia para instalaciones nuevas), no alteró la tabla ya existente en el proyecto Supabase compartido. Síntoma: `PGRST204 Could not find the 'jefe_proyecto' column...` en cualquier `insert`/`update` de `projects` (bloqueaba **todo** `attRepo.save()`, no solo cosas nuevas). `NOTIFY pgrst, 'reload schema'` NO lo arregla (no es problema de caché; la columna de verdad no existía — confirmado con `SELECT jefe_proyecto` dando `42703 column does not exist`, con hint apuntando a `jefe_proyecto_id`, la FK que sí existe). Fix aplicado ya en la BD: `alter table public.projects add column if not exists jefe_proyecto text;`. **Lección**: cuando se edite `0001_init.sql` para reflejar un cambio de esquema en una tabla que ya existe en producción, hay que además correr el `ALTER TABLE` real contra la BD — editar el archivo de referencia no basta.

## Setup en un PC nuevo
Prerrequisitos: **Node 22** (el que usa el deploy) y **git**. No hace falta copiar nada a mano salvo el `.env`.
```bash
git clone https://github.com/Sinterk/TelecomCatalog.git
cd TelecomCatalog
git checkout backend-supabase
npm install
# crear .env (gitignored) con:
#   VITE_SUPABASE_URL=https://xwawplezarrfonuyaaxu.supabase.co
#   VITE_SUPABASE_ANON_KEY=sb_publishable_x01p7hsYvNKlWklAQ11H-Q_KPenq-XW
#   VITE_GUEST_EMAIL=abarahona.sinterk@gmail.com          # modo invitado
#   VITE_GUEST_PASSWORD=...                                # pegar tal cual, sin comillas (tiene caracteres especiales)
npm run dev   # sin certs mkcert corre en http://localhost:5173
```
> **NO re-ejecutar** `supabase/migrations/0001_init.sql` ni `0002_preventivos.sql`: ambos ya están aplicados en el proyecto Supabase compartido (`xwawplezarrfonuyaaxu`). Son solo para instalaciones nuevas o de referencia del esquema.

## Convenciones y reglas
- **Commits en español**, terminando con el trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. No commitear `.claude/launch.json` ni `.env`.
- **Subir la versión** (`APP_VERSION` en `vite.config.ts`) en cada cambio visible.
- **NO hacer push/merge a `main` todavía**: push a `main` dispara el deploy y publica el gate de login, dejando fuera a los usuarios actuales (que aún no tienen cuenta). Trabajar en `backend-supabase`; recién fusionar a `main` cuando datos + usuarios estén listos, como cutover coordinado.
- **Gotcha PWA/caché**: la app instalada suele servir el bundle viejo hasta cerrarla del todo (no solo minimizar) o borrar datos del sitio; por eso se sube `APP_VERSION` para confirmar el bundle nuevo.
- **La cuenta invitado es una cuenta real y compartida — cuidado al probar la pantalla de admin con ella**: en una sesión de prueba su `rol` quedó en `log` en vez de `jp` (probablemente al probar el selector de rol en Usuarios), lo que rompió silenciosamente el modo invitado (un `log` no puede crear/editar proyectos vía RLS) hasta notarlo y corregirlo. Si el modo invitado deja de poder guardar, lo primero a chequear es `select rol from profiles where email='abarahona.sinterk@gmail.com'` — debe decir `jp`.

## Próximos pasos (en orden)
1. ~~**Capa de datos** `src/modules/att/data/attRepo.ts`~~ ✅ **HECHO**. Mapeo clave: `jefeProyecto`→`projects.jefe_proyecto` (texto), `fotoAerea`→`informes.foto_general_path`, `ingresoRed`/`infraestructura`→jsonb.
2. ~~**Fotos → Storage**~~ ✅ **HECHO** (ver "Estado actual").
3. ~~**Refactor del store online-first**~~ ✅ **HECHO** (ver "Estado actual"). Falta cablear un botón/indicador de "informe cerrado" en la UI si algún día se quiere una vista de cerrados (hoy hay filtro Activos/Cerrados/Todos en Home, pero no hay acción de "reabrir" un cerrado).
4. ~~**Migración de borradores locales**~~ ✅ **HECHO** (ver "Estado actual"). Es un aviso manual en Home, no una migración automática silenciosa — el técnico ve el botón y decide cuándo sincronizar.
5. ~~**Pantalla admin**~~ ✅ **HECHO** (ver "Estado actual"): edición de perfiles + equipo por proyecto (ahora incluye proyectos de ambos módulos). Verificado por el usuario con la cuenta admin real, incluido el fix de auto-democión.
6. ~~**Migración de Preventivos a Supabase**~~ ✅ **HECHO** (ver "Estado actual", paso 6): mismo patrón de ATT replicado — esquema nuevo, capa de datos, fotos a Storage, store online-first, filtro/buscador. Verificado en el navegador de punta a punta.
7. **← SIGUIENTE** — módulo de inventario (tablas ya en el esquema, sin UI). Incluye las vistas por rol pospuestas: técnico ve sus OTTs/cuadrantes asignados + "Material asignado" (filtrable por material y por proyecto) donde JP/admin ven "Gestión de inventario". A detallar cuando se retome.

## Verificar conexión (PowerShell)
```powershell
$h = @{ apikey = "sb_publishable_x01p7hsYvNKlWklAQ11H-Q_KPenq-XW" }
Invoke-WebRequest -Uri "https://xwawplezarrfonuyaaxu.supabase.co/rest/v1/materiales?select=*&limit=1" -Headers $h -UseBasicParsing
# esperado: HTTP 200, body [] (RLS bloquea filas sin login)
```
