import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export type Rol = 'admin' | 'jp' | 'tecnico' | 'log'

export const ROL_LABELS: Record<Rol, string> = {
  admin:   'Administrador',
  jp:      'Jefe de proyecto',
  tecnico: 'Técnico',
  log:     'Logística',
}

export interface Profile {
  id: string
  nombre: string | null
  email: string | null
  rol: Rol
  area: string | null
  activo: boolean
}

// Cuenta compartida de "invitado" (temporal, mientras se definen los usuarios
// reales). Es un usuario real de Supabase con rol jp; las credenciales viven en
// .env. OJO: al ser vars VITE_*, quedan embebidas en el bundle → NO desplegar a
// producción con esta cuenta activa. Es un puente para uso interno/no publicado.
const GUEST_EMAIL = (import.meta.env.VITE_GUEST_EMAIL ?? '').trim()
const GUEST_PASSWORD = import.meta.env.VITE_GUEST_PASSWORD ?? ''

/** ¿está configurado el modo invitado? (controla si se muestra el botón) */
export const guestEnabled = !!GUEST_EMAIL && !!GUEST_PASSWORD

/**
 * Contraseña del invitado. Solo se usa para el "mostrar contraseña" de la cuenta
 * compartida; ya está embebida en el bundle (VITE_*), así que exponerla en la UI
 * no añade riesgo. NO aplica a usuarios reales (sus claves están hasheadas).
 */
export const guestPassword = GUEST_PASSWORD

function computeIsGuest(session: Session | null): boolean {
  if (!session || !GUEST_EMAIL) return false
  return session.user.email?.toLowerCase() === GUEST_EMAIL.toLowerCase()
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  isGuest: boolean          // sesión abierta con la cuenta compartida de invitado
  loading: boolean          // true mientras se resuelve la sesión inicial
  init: () => void
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signInAsGuest: () => Promise<{ error?: string }>
  changePassword: (current: string, next: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nombre, email, rol, area, activo')
    .eq('id', userId)
    .single()
  if (error) {
    console.error('[auth] no se pudo cargar el perfil:', error.message)
    return null
  }
  return data as Profile
}

let initialized = false

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  isGuest: false,
  loading: true,

  init: () => {
    if (initialized) return
    initialized = true

    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile, isGuest: computeIsGuest(session), loading: false })
    })

    supabase.auth.onAuthStateChange(async (_event, session) => {
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile, isGuest: computeIsGuest(session), loading: false })
    })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    return { error: error?.message }
  },

  signInAsGuest: async () => {
    if (!guestEnabled) return { error: 'El modo invitado no está configurado.' }
    const { error } = await supabase.auth.signInWithPassword({
      email: GUEST_EMAIL,
      password: GUEST_PASSWORD,
    })
    return { error: error?.message }
  },

  changePassword: async (current, next) => {
    if (get().isGuest) {
      return { error: 'La contraseña del invitado se gestiona en el .env, no aquí.' }
    }
    const email = get().session?.user.email
    if (!email) return { error: 'No hay sesión activa.' }
    // Endurecimiento: verificar la contraseña actual reintentando el login.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: current })
    if (verifyErr) return { error: 'La contraseña actual es incorrecta.' }
    // Cambio real: se hashea en el servidor.
    const { error } = await supabase.auth.updateUser({ password: next })
    return { error: error?.message }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null, isGuest: false })
  },
}))
