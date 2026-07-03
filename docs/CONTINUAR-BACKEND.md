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
Commits v0.51 + fix de esquema. **No se hizo push a `main`** para no publicar el gate de login sin datos conectados ni usuarios (el sitio en vivo sigue en v0.50, sin login).

Ya hecho:
- `src/lib/supabaseClient.ts` — cliente supabase-js leyendo `VITE_SUPABASE_*`.
- `src/lib/auth.ts` — store Zustand de auth (sesión + perfil/rol, `signIn`/`signOut`).
- `src/ui/LoginScreen.tsx` — login real email/contraseña.
- `src/App.tsx` — gatea por sesión; bloquea cuentas desactivadas.
- `.env.production` versionado; build de producción pasa.

## Gotchas importantes
- **Publishable key `sb_publishable_` NO es JWT**: para probar la REST API anónima con curl/PowerShell, mandar SOLO el header `apikey` (NO `Authorization: Bearer`, da 401).
- La migración usa `set check_function_bodies = off` para permitir que las funciones referencien tablas creadas más abajo.
- Los roles anon/authenticated necesitan `GRANT` (ya aplicados; incluidos en la migración para instalaciones nuevas).
- **`.env` es gitignored** — recrear en cada PC (ver setup abajo).
- **Primer admin**: Supabase → Authentication → Add user (marcar *Auto Confirm*), luego `update public.profiles set rol='admin', nombre='...' where email='...';`

## Setup en un PC nuevo
```bash
git clone https://github.com/Sinterk/TelecomCatalog.git
cd TelecomCatalog
git checkout backend-supabase
npm install
# crear .env (gitignored) con:
#   VITE_SUPABASE_URL=https://xwawplezarrfonuyaaxu.supabase.co
#   VITE_SUPABASE_ANON_KEY=sb_publishable_x01p7hsYvNKlWklAQ11H-Q_KPenq-XW
npm run dev   # sin certs mkcert corre en http://localhost:5173
```

## Próximos pasos (en orden)
1. **Capa de datos** `src/modules/att/data/attRepo.ts`: mapear `AttRecord` ↔ `projects` + `informes` + `tramos`/`hitos`/`fotos`; CRUD (list/load/save/delete). Mapeo clave: `jefeProyecto`→`projects.jefe_proyecto` (texto), `fotoAerea`→`informes.foto_general_path`, `ingresoRed`/`infraestructura`→jsonb.
2. **Fotos → Storage** (bucket `fotos`, privado): subir blob, guardar `storage_path` en `fotos`/`foto_general_path`; leer con signed URLs.
3. **Refactor del store** `src/modules/att/store.ts`: online-first (leer/escribir Supabase; Zustand como caché). `createNew` pasa a insertar y devolver el uuid.
4. **Migración** IndexedDB (`att-store-v3` + blobs idb) → Supabase: herramienta que sube los informes locales existentes.
5. Luego: pantalla admin (crear usuarios, asignar rol, `project_members`) y módulo de inventario.

## Verificar conexión (PowerShell)
```powershell
$h = @{ apikey = $env:VITE_SUPABASE_ANON_KEY }
Invoke-WebRequest -Uri "https://xwawplezarrfonuyaaxu.supabase.co/rest/v1/materiales?select=*&limit=1" -Headers $h -UseBasicParsing
# esperado: HTTP 200, body [] (RLS bloquea filas sin login)
```
