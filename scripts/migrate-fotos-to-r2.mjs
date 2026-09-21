#!/usr/bin/env node
// Migración única: copia las fotos que ya existen en el bucket `fotos` de
// Supabase Storage al bucket R2 (Cloudflare), manteniendo el mismo path
// (`att/{blobId}.jpg`, `preventivos/{blobId}.jpg`, `incidencias/{blobId}.jpg`)
// — así no hace falta tocar ni una fila de la base de datos, `storagePath`
// sigue siendo válido tal cual.
//
// Para las fotos de Preventivos también genera y sube la miniatura
// (`preventivos/thumbs/{blobId}.jpg`, 200px, calidad 60) — sin esto, las
// fotos ya existentes se seguirían viendo bien (la app cae a la foto
// completa si no hay miniatura), pero perderían la mejora de velocidad de
// v2.05 hasta que alguien las volviera a subir, cosa que para un
// levantamiento ya cerrado puede no pasar nunca.
//
// Es seguro correrlo más de una vez: si un objeto ya existe en R2, se
// salta (no lo vuelve a bajar ni a subir). Si se corta a mitad de camino,
// se puede volver a correr y sigue donde quedó.
//
// ANTES DE CORRER (una vez, no queda en package.json):
//   npm install --no-save @supabase/supabase-js @aws-sdk/client-s3 sharp
//
// USO (con tus propias claves reales — NUNCA las pegues en el chat ni las
// commitees; SUPABASE_SERVICE_ROLE_KEY se ve en Supabase → Project Settings
// → API → service_role, y las R2_* son las mismas que ya guardaste como
// secrets de la Edge Function):
//
//   SUPABASE_URL=https://xwawplezarrfonuyaaxu.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   R2_ACCOUNT_ID=... \
//   R2_ACCESS_KEY_ID=... \
//   R2_SECRET_ACCESS_KEY=... \
//   R2_BUCKET_NAME=sinterk \
//   node scripts/migrate-fotos-to-r2.mjs

import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'

const REQUIRED_ENV = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
]
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`Falta la variable de entorno ${k}. Ver el comentario de este script para el uso completo.`)
    process.exit(1)
  }
}

const SUPABASE_BUCKET = 'fotos'
// Prefijos reales usados por cada módulo — ver *_data/photoStorage.ts de cada uno.
const PREFIXES = ['att', 'preventivos', 'incidencias']
const CONCURRENCY = 6

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

async function listAllPaths(prefix) {
  const paths = []
  let offset = 0
  const limit = 1000
  for (;;) {
    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).list(prefix, {
      limit, offset, sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`list(${prefix}): ${error.message}`)
    if (!data || data.length === 0) break
    // Supabase Storage lista "carpetas" como entradas sin `id` — se saltan (no hay subcarpetas reales acá).
    for (const item of data) if (item.id) paths.push(`${prefix}/${item.name}`)
    if (data.length < limit) break
    offset += limit
  }
  return paths
}

async function existsInR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
    return true
  } catch {
    return false
  }
}

async function putR2(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: contentType }))
}

/** Copia una foto (y, si es de Preventivos, también su miniatura). Idempotente. */
async function migrateOne(path) {
  const isPreventivo = path.startsWith('preventivos/')
  const thumbPath = isPreventivo ? path.replace(/^preventivos\//, 'preventivos/thumbs/') : null

  const needOriginal = !(await existsInR2(path))
  const needThumb = thumbPath ? !(await existsInR2(thumbPath)) : false
  if (!needOriginal && !needThumb) return 'skip'

  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(path)
  if (error) throw new Error(`download(${path}): ${error.message}`)
  const buf = Buffer.from(await data.arrayBuffer())
  const contentType = data.type || 'image/jpeg'

  const tasks = []
  if (needOriginal) tasks.push(putR2(path, buf, contentType))
  if (needThumb) {
    tasks.push(
      sharp(buf)
        .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer()
        .then((thumbBuf) => putR2(thumbPath, thumbBuf, 'image/jpeg')),
    )
  }
  await Promise.all(tasks)
  return 'copied'
}

async function main() {
  let allPaths = []
  for (const prefix of PREFIXES) {
    const paths = await listAllPaths(prefix)
    console.log(`${prefix}: ${paths.length} archivo(s)`)
    allPaths = allPaths.concat(paths)
  }
  console.log(`Total a revisar: ${allPaths.length}\n`)

  let copied = 0, skipped = 0, failed = 0
  let i = 0
  async function worker() {
    while (i < allPaths.length) {
      const path = allPaths[i++]
      try {
        const result = await migrateOne(path)
        if (result === 'copied') copied++
        else skipped++
        const done = copied + skipped + failed
        if (done % 50 === 0) console.log(`  progreso: ${done}/${allPaths.length}`)
      } catch (err) {
        failed++
        console.error(`  FALLÓ ${path}: ${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log(`\nListo. Copiadas: ${copied} — ya existían en R2: ${skipped} — fallidas: ${failed}`)
  if (failed > 0) {
    console.log('Vuelve a correr el script: es seguro repetirlo, solo reintenta lo que falló.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
