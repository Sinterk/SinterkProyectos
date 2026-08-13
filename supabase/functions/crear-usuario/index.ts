// Edge Function: alta de trabajadores desde Administración.
//
// POR QUÉ EXISTE ESTO Y NO ES UN RPC MÁS
// --------------------------------------
// Crear una cuenta escribe en `auth.users`, y eso solo lo permite la Admin
// API de Supabase con la clave `service_role`. Esa clave salta TODO el RLS:
// quien la tenga puede leer y escribir cualquier tabla de cualquier usuario.
// Por eso NO puede estar en la app — el bundle es público, cualquiera abre
// las DevTools y la copia.
//
// Una Edge Function corre en el servidor de Supabase, no en el navegador. La
// clave vive ahí (en las variables de entorno de la función) y nunca viaja al
// cliente. La app solo manda "crea este usuario" con el token del admin, y
// esta función decide si tiene permiso.
//
// LAS DOS COMPROBACIONES
// ----------------------
// 1. `verify_jwt` (activado por defecto) rechaza cualquier llamada sin un
//    token válido de Supabase. Eso prueba que quien llama inició sesión.
// 2. Iniciar sesión NO es ser admin. Acá se vuelve a preguntar por el rol
//    usando el token DEL QUE LLAMA (cliente `userClient`, clave anon), que
//    ejecuta `is_admin()` bajo su propia identidad y su propio RLS. Un técnico
//    que copie la URL de la función se queda en este paso.
//
// Recién después de las dos se usa la service_role.
//
// DESPLIEGUE (una vez, con la CLI de Supabase):
//   supabase functions deploy crear-usuario
// Las variables SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// las inyecta Supabase sola — no hay que configurarlas ni ponerlas en el .env
// del proyecto.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLES_VALIDOS = ['admin', 'jp', 'tecnico', 'log']
const AREAS_VALIDAS = ['ATT', 'OyM']

interface Payload {
  email?: string
  password?: string
  nombre?: string
  rol?: string
  area?: string | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Falta el token de sesión' }, 401)

  // Cliente con la identidad del que llama: todo lo que haga pasa por su RLS.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Sesión inválida' }, 401)

  const { data: esAdmin, error: rolError } = await userClient.rpc('is_admin')
  if (rolError) return json({ error: `No se pudo verificar el rol: ${rolError.message}` }, 500)
  if (!esAdmin) return json({ error: 'Solo un administrador puede crear usuarios' }, 403)

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }

  const email = payload.email?.trim().toLowerCase() ?? ''
  const password = payload.password ?? ''
  const nombre = payload.nombre?.trim() ?? ''
  const rol = payload.rol ?? 'tecnico'
  const area = payload.area?.trim() || null

  if (!email || !email.includes('@')) return json({ error: 'Correo inválido' }, 400)
  // Mismo mínimo que exige Supabase Auth por defecto: mejor rechazarlo acá con
  // un mensaje claro que dejar que reviente más adelante.
  if (password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)
  if (!nombre) return json({ error: 'Falta el nombre' }, 400)
  if (!ROLES_VALIDOS.includes(rol)) return json({ error: `Rol no reconocido: ${rol}` }, 400)
  if (area !== null && !AREAS_VALIDAS.includes(area)) return json({ error: `Área no reconocida: ${area}` }, 400)

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // `email_confirm: true` = la cuenta queda utilizable de inmediato. Sin esto
  // Supabase manda un correo de confirmación y la persona no puede entrar
  // hasta hacer clic; acá la crea un admin en persona, no hay nada que
  // confirmar. `user_metadata` es lo que lee el trigger `handle_new_user`
  // (0001_init.sql) para armar la fila de `profiles` con nombre y rol.
  const { data: creado, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre, rol },
  })

  if (createError) {
    const yaExiste = createError.message.toLowerCase().includes('already')
    return json({ error: yaExiste ? 'Ya existe un usuario con ese correo' : createError.message }, yaExiste ? 409 : 400)
  }

  const nuevoId = creado.user?.id
  if (!nuevoId) return json({ error: 'El usuario se creó pero no devolvió id' }, 500)

  // El área no la cubre el trigger (no está en su INSERT), así que se escribe
  // acá. Un update, no un insert: la fila ya existe. Si falla, el usuario YA
  // quedó creado — se avisa en vez de mentir con un 500 genérico, porque
  // reintentar el alta completa daría "ya existe ese correo".
  const { error: perfilError } = await adminClient
    .from('profiles')
    .update({ nombre, rol, area })
    .eq('id', nuevoId)

  if (perfilError) {
    return json({
      error: `El usuario se creó, pero no se pudo completar su ficha: ${perfilError.message}. Ajústala desde la lista de usuarios.`,
      userId: nuevoId,
    }, 207)
  }

  return json({ userId: nuevoId, email, nombre, rol, area })
})
