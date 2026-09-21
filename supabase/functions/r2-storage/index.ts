// Edge Function: URLs prefirmadas (subir/bajar) y borrado de objetos en el
// bucket R2 de Cloudflare — reemplaza a Supabase Storage para las fotos.
//
// POR QUÉ UNA EDGE FUNCTION Y NO LLAMAR A R2 DIRECTO DESDE EL NAVEGADOR
// -----------------------------------------------------------------------
// Firmar una URL de R2 (subida o bajada) requiere la Secret Access Key de la
// cuenta de Cloudflare. Esa clave NO puede vivir en el bundle del navegador
// (es público, cualquiera la copia desde DevTools) — igual razón que
// `crear-usuario/index.ts` con la service_role key de Supabase. Acá la
// clave vive en los secrets de esta función, nunca viaja al cliente: el
// navegador solo recibe la URL ya firmada, con vencimiento.
//
// NIVEL DE ACCESO: a diferencia de `crear-usuario` (exclusivo admin), acá
// solo se exige sesión válida — mismo nivel que tenía la política del
// bucket `fotos` en Supabase Storage (`auth.uid() not null`, sin filtrar
// por rol ni por path). No se agrega ni se quita control de acceso al
// migrar de Supabase Storage a R2.
//
// SECRETS REQUERIDOS (Project Settings → Edge Functions → Secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//
// DESPLIEGUE: pegar este archivo en el dashboard de Supabase
// (Edge Functions → Deploy a new function → nombre "r2-storage"), o
// `supabase functions deploy r2-storage` si se tiene la CLI instalada.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from 'npm:@aws-sdk/client-s3@3'
import { getSignedUrl as presign } from 'npm:@aws-sdk/s3-request-presigner@3'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Igual vigencia que tenían las signed URLs de Supabase Storage. */
const DEFAULT_TTL = 60 * 60
/** Tope por llamada — de sobra para el cuadrante más grande visto (134 fotos) y bajo el límite de 1000 de DeleteObjects. */
const MAX_PATHS = 500

type Action = 'sign-get' | 'sign-put' | 'delete'

interface Payload {
  action?: Action
  paths?: string[]
  /** Solo para sign-get/sign-put, en segundos. */
  expiresIn?: number
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const accountId = Deno.env.get('R2_ACCOUNT_ID')
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
  const bucket = Deno.env.get('R2_BUCKET_NAME')
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return json({ error: 'Faltan secrets R2_* en esta función (Project Settings → Edge Functions → Secrets)' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Falta el token de sesión' }, 401)

  // Prueba que quien llama inició sesión de verdad — mismo patrón que
  // `crear-usuario` (ver su comentario). Acá no hace falta pedir un rol
  // específico: cualquier sesión válida podía pedir una signed URL con
  // Supabase Storage, y se mantiene ese mismo nivel de acceso.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Sesión inválida' }, 401)

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Cuerpo inválido' }, 400)
  }

  const paths = (payload.paths ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (paths.length === 0) return json({ error: 'Falta "paths"' }, 400)
  if (paths.length > MAX_PATHS) return json({ error: `Máximo ${MAX_PATHS} rutas por llamada` }, 400)

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  if (payload.action === 'delete') {
    try {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: paths.map((Key) => ({ Key })) } }))
      return json({ ok: true })
    } catch (err) {
      return json({ error: `r2.delete: ${(err as Error).message}` }, 500)
    }
  }

  if (payload.action !== 'sign-get' && payload.action !== 'sign-put') {
    return json({ error: `Acción no reconocida: ${payload.action}` }, 400)
  }

  // Sin límite mínimo aparte del de la propia API de R2/S3 (1s–7 días);
  // el máximo lo fija el llamador, acotado a 24h como tope defensivo.
  const expiresIn = Math.min(Math.max(payload.expiresIn ?? DEFAULT_TTL, 1), 24 * 60 * 60)

  try {
    const entries = await Promise.all(paths.map(async (path) => {
      const command = payload.action === 'sign-put'
        ? new PutObjectCommand({ Bucket: bucket, Key: path })
        : new GetObjectCommand({ Bucket: bucket, Key: path })
      const url = await presign(s3, command, { expiresIn })
      return [path, url] as const
    }))
    return json({ urls: Object.fromEntries(entries) })
  } catch (err) {
    return json({ error: `r2.sign: ${(err as Error).message}` }, 500)
  }
})
