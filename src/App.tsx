import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { registry } from '@/core/registry/projectRegistry'
import { Layout } from '@/ui/Layout'
import { ProjectHome } from '@/ui/ProjectHome'
import { LoginScreen } from '@/ui/LoginScreen'
import { AdminScreen } from '@/ui/AdminScreen'
import { useAuth } from '@/lib/auth'

import '@/modules/preventivos'
import '@/modules/att'
import '@/modules/inventario'

export function App() {
  const modules = registry.getAll()
  const { session, profile, loading, init, signOut } = useAuth()

  useEffect(() => { init() }, [init])

  // Resolviendo sesión inicial
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-4xl animate-pulse">📡</div>
      </div>
    )
  }

  // Sin sesión → login
  if (!session) return <LoginScreen />

  // Con sesión pero cuenta desactivada
  if (profile && !profile.activo) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center gap-4">
        <div className="text-4xl">🔒</div>
        <p className="text-slate-300 text-sm max-w-xs">
          Tu cuenta está desactivada. Contacta a un administrador.
        </p>
        <button onClick={signOut}
          className="text-xs text-brand-400 hover:text-brand-300 underline">Cerrar sesión</button>
      </div>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectHome />} />
        <Route path="/admin" element={<AdminScreen />} />
        {modules.flatMap((mod) =>
          mod.routes.map((route) => {
            const Component = route.component
            return <Route key={route.path} path={route.path} element={<Component />} />
          }),
        )}
        <Route path="*" element={<ProjectHome />} />
      </Routes>
    </Layout>
  )
}
