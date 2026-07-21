// Carga masiva de usuarios (técnicos u otros roles) desde un Excel con
// columnas APELLIDO, NOMBRE, RUT, CORREOEMPRESA y, opcionalmente, ROL — vía
// el Admin API de Supabase Auth. Requiere la service_role key — NUNCA la
// pongas en .env con prefijo VITE_ (se empaquetaría en el bundle público).
// Pásala solo como variable de entorno al correr este script, en tu propia
// terminal.
//
// Uso (PowerShell, desde la raíz del repo):
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "tu_clave_aqui"
//   node scripts/importar-usuarios.mjs ruta\al\archivo.xlsx
//
// Columna ROL (opcional, por fila): acepta el valor interno (admin/jp/
// tecnico/log) o el nombre visible actual/histórico en la app (Admin,
// Oficina, Jefe de proyecto, Terreno, Técnico, Logística — sin distinguir
// mayúsculas/tildes). Si viene vacía, se usa IMPORTAR_ROL (por defecto
// 'tecnico'); si viene con un valor que no se reconoce, esa fila se omite
// con aviso en vez de asignar cualquier cosa a ciegas.
//
// Contraseña inicial de cada cuenta = su propio RUT (con guion, sin puntos:
// "12345678-9") — no hace falta comunicar nada por otro canal, cada persona
// ya se lo sabe. Cada quien puede cambiarla después desde el menú de
// usuario ("Cambiar contraseña"), que ya existe en la app.

import { createClient } from '@supabase/supabase-js'
// xlsx-js-style es CJS; en un script .mjs plano sus exports quedan bajo
// `.default` (Node no logra detectar los named exports de este paquete).
import XLSXMod from 'xlsx-js-style'
const XLSX = XLSXMod.default ?? XLSXMod

const SUPABASE_URL = 'https://xwawplezarrfonuyaaxu.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ROL = process.env.IMPORTAR_ROL || 'tecnico'
const archivo = process.argv[2]

if (!SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno. Ver instrucciones arriba del archivo.')
  process.exit(1)
}
if (!archivo) {
  console.error('Uso: node scripts/importar-usuarios.mjs ruta\\al\\archivo.xlsx')
  process.exit(1)
}

function normalizarRut(valor) {
  const limpio = String(valor).replace(/[.\s]/g, '').toUpperCase()
  if (!limpio) return ''
  return limpio.includes('-') ? limpio : `${limpio.slice(0, -1)}-${limpio.slice(-1)}`
}

// Valores internos reales en BD (ver Rol en src/lib/auth.ts) + alias por
// nombre visible, actual e histórico, para que la columna ROL del Excel
// pueda venir escrita como la gente realmente la conoce.
const ROL_ALIASES = {
  admin: 'admin', administrador: 'admin',
  jp: 'jp', oficina: 'jp', 'jefe de proyecto': 'jp',
  tecnico: 'tecnico', técnico: 'tecnico', terreno: 'tecnico',
  log: 'log', logistica: 'log', logística: 'log',
}
function normalizarRol(valor) {
  const key = String(valor || '').trim().toLowerCase()
  if (!key) return { rol: null, vacio: true }
  return { rol: ROL_ALIASES[key] || null, vacio: false }
}

function leerFilas(path) {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const filas = XLSX.utils.sheet_to_json(ws, { defval: '' })

  // Columnas case-insensitive por si el Excel real las trae con otra
  // capitalización (Apellido, apellido, APELLIDO, ...).
  return filas.map((fila) => {
    const norm = {}
    for (const [k, v] of Object.entries(fila)) norm[k.trim().toUpperCase()] = String(v).trim()
    return {
      apellido: norm.APELLIDO || '',
      nombre: norm.NOMBRE || '',
      rut: normalizarRut(norm.RUT || ''),
      email: (norm.CORREOEMPRESA || '').toLowerCase(),
      rolCrudo: norm.ROL || '',
    }
  }).filter((r) => r.email) // sin correo no hay cuenta que crear
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const filas = leerFilas(archivo)
console.log(`${filas.length} fila(s) con correo encontradas en ${archivo}.\n`)

let creados = 0, saltados = 0, errores = 0

for (const f of filas) {
  if (!f.rut) {
    console.error(`✗ ${f.email}: sin RUT, se omite (la contraseña inicial depende de él)`)
    errores++
    continue
  }

  const { rol: rolFila, vacio: rolVacio } = normalizarRol(f.rolCrudo)
  if (!rolVacio && !rolFila) {
    console.error(`✗ ${f.email}: rol "${f.rolCrudo}" no reconocido (admin/oficina/terreno/logística), se omite`)
    errores++
    continue
  }
  const rol = rolFila || ROL

  const nombreCompleto = [f.nombre, f.apellido].filter(Boolean).join(' ')
  const password = f.rut // contraseña inicial = RUT con guion, sin puntos

  const { data, error } = await supabase.auth.admin.createUser({
    email: f.email,
    password,
    email_confirm: true, // sin esto queda sin confirmar y no puede loguear
    user_metadata: { nombre: nombreCompleto, rol },
  })

  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      console.log(`— ${f.email}: ya existe, se omite`)
      saltados++
    } else {
      console.error(`✗ ${f.email}: ${error.message}`)
      errores++
    }
    continue
  }

  console.log(`✓ ${f.email} creado (${nombreCompleto}, rol ${rol})`)
  creados++

  // El trigger handle_new_user ya usa nombre/rol de user_metadata; acá solo
  // falta el rut, que no es parte del trigger.
  const { error: updateError } = await supabase.from('profiles').update({ rut: f.rut }).eq('id', data.user.id)
  if (updateError) {
    console.error(`  (no se pudo guardar el rut: ${updateError.message} — ¿falta correr 0017_profiles_rut.sql?)`)
  }
}

console.log(`\nListo. Creados: ${creados} · Ya existían: ${saltados} · Con error: ${errores}`)
console.log('Contraseña inicial de cada cuenta: su propio RUT (con guion, sin puntos).')
