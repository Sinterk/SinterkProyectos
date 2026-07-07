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
- **Esquema**: `supabase/migrations/0001_init.sql` — YA ejecutado en Supabase, más los `GRANT` a anon/authenticated y `alter table projects add column jefe_proyecto`. RLS verificada funcionando.

### Roles y acceso (RLS)
`admin` (todo) · `jp` (ve/edita TODOS los proyectos, asigna técnicos) · `tecnico` (solo proyectos donde está en `project_members`) · `log` (mueve inventario). Solo el admin crea usuarios (no hay registro público). Crear proyectos = solo jp/admin.

### Modelo de datos (resumen)
- `projects` (maestro OTT; 1 informe por OTT; cierre + versionado por copia) separado de `informes` (el ATT) + hijos `tramos`/`hitos`/`fotos`.
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
> **NO re-ejecutar** `supabase/migrations/0001_init.sql`: ya está aplicado en el proyecto Supabase compartido (`xwawplezarrfonuyaaxu`). Ese archivo es solo para instalaciones nuevas o de referencia del esquema.

## Convenciones y reglas
- **Commits en español**, terminando con el trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. No commitear `.claude/launch.json` ni `.env`.
- **Subir la versión** (`APP_VERSION` en `vite.config.ts`) en cada cambio visible.
- **NO hacer push/merge a `main` todavía**: push a `main` dispara el deploy y publica el gate de login, dejando fuera a los usuarios actuales (que aún no tienen cuenta). Trabajar en `backend-supabase`; recién fusionar a `main` cuando datos + usuarios estén listos, como cutover coordinado.
- **Gotcha PWA/caché**: la app instalada suele servir el bundle viejo hasta cerrarla del todo (no solo minimizar) o borrar datos del sitio; por eso se sube `APP_VERSION` para confirmar el bundle nuevo.

## Próximos pasos (en orden)
1. ~~**Capa de datos** `src/modules/att/data/attRepo.ts`~~ ✅ **HECHO**. Mapeo clave: `jefeProyecto`→`projects.jefe_proyecto` (texto), `fotoAerea`→`informes.foto_general_path`, `ingresoRed`/`infraestructura`→jsonb.
2. ~~**Fotos → Storage**~~ ✅ **HECHO** (ver "Estado actual").
3. ~~**Refactor del store online-first**~~ ✅ **HECHO** (ver "Estado actual"). Falta cablear un botón/indicador de "informe cerrado" en la UI si algún día se quiere una vista de cerrados (hoy simplemente desaparecen de la lista de activos).
4. **← SIGUIENTE — Migración** IndexedDB (`att-store-v3` + blobs idb) → Supabase: herramienta que sube los informes locales existentes de cada técnico/PC (los que quedaron huérfanos como borradores nanoid antes de este cutover).
5. Luego: pantalla admin (crear usuarios, asignar rol, `project_members`) y módulo de inventario.

## Verificar conexión (PowerShell)
```powershell
$h = @{ apikey = "sb_publishable_x01p7hsYvNKlWklAQ11H-Q_KPenq-XW" }
Invoke-WebRequest -Uri "https://xwawplezarrfonuyaaxu.supabase.co/rest/v1/materiales?select=*&limit=1" -Headers $h -UseBasicParsing
# esperado: HTTP 200, body [] (RLS bloquea filas sin login)
```
