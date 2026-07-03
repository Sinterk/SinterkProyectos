import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // No aborta el build; el login mostrará el error al intentar conectar.
  console.error('[supabase] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
