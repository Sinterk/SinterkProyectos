/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_URL: string
  readonly VITE_ANNOTATION_PHASE: string
  readonly VITE_APP_MODE: 'office' | 'field'
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Inyectados por Vite (define) en build/dev — ver vite.config.ts
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
