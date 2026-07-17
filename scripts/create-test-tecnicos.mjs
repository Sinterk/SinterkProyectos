// Crea los 3 técnicos de prueba (tecnico1/2/3@sinterk.cl) vía el Admin API de
// Supabase Auth. Requiere la service_role key — NUNCA la pongas en .env con
// prefijo VITE_ (se empaquetaría en el bundle público). Pásala solo como
// variable de entorno al correr este script, en tu propia terminal.
//
// Uso (PowerShell, desde la raíz del repo para que resuelva
// @supabase/supabase-js de node_modules):
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "tu_clave_aqui"
//   node scripts/create-test-tecnicos.mjs
//
// Opcional: TECNICO_TEST_PASSWORD para elegir la contraseña (por defecto
// usa una fija de prueba, ver abajo). Borra este archivo cuando ya no lo
// necesites — no es parte de la app, es un utilitario de una sola vez.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xwawplezarrfonuyaaxu.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = process.env.TECNICO_TEST_PASSWORD || 'TecnicoPrueba123!'

if (!SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno. Ver instrucciones arriba del archivo.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const tecnicos = [
  { email: 'tecnico1@sinterk.cl', nombre: 'Técnico 1' },
  { email: 'tecnico2@sinterk.cl', nombre: 'Técnico 2' },
  { email: 'tecnico3@sinterk.cl', nombre: 'Técnico 3' },
]

for (const t of tecnicos) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: t.email,
    password: PASSWORD,
    email_confirm: true, // sin esto quedaría sin confirmar y no podría loguear
  })

  if (error) {
    console.error(`✗ ${t.email}: ${error.message}`)
    continue
  }

  console.log(`✓ ${t.email} creado (id ${data.user.id})`)

  // El trigger handle_new_user ya crea la fila en profiles con rol='tecnico'
  // por defecto — solo le ponemos un nombre legible para la UI.
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ nombre: t.nombre })
    .eq('id', data.user.id)

  if (updateError) console.error(`  (no se pudo poner el nombre: ${updateError.message})`)
}

console.log(`\nListo. Contraseña usada para los 3: ${PASSWORD}`)
