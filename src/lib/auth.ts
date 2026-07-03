import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export type Rol = 'admin' | 'jp' | 'tecnico' | 'log'

export interface Profile {
  id: string
  nombre: string | null
  email: string | null
  rol: Rol
  area: string | null
  activo: boolean
}

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean          // true mientras se resuelve la sesión inicial
  init: () => void
  signIn: (email: string, password: string) => Promise<{ error?: string }>
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

export const useAuth = create<AuthState>((set) => ({
  session: null,
  profile: null,
  loading: true,

  init: () => {
    if (initialized) return
    initialized = true

    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile, loading: false })
    })

    supabase.auth.onAuthStateChange(async (_event, session) => {
      const profile = session ? await fetchProfile(session.user.id) : null
      set({ session, profile, loading: false })
    })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    return { error: error?.message }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, profile: null })
  },
}))
