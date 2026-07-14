import { NavLink, useLocation } from 'react-router-dom'
import { registry } from '@/core/registry/projectRegistry'
import { useAuth } from '@/lib/auth'
import { UserMenu } from './UserMenu'
import { OfflineBanner } from './OfflineBanner'

interface Props { children: React.ReactNode }

// Hora de build (mes-día hh:mm) para confirmar que el SW cargó el bundle nuevo
const buildStamp = (() => {
  const d = new Date(__BUILD_DATE__)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})()

export function Layout({ children }: Props) {
  const modules = registry.getAll()
  const { pathname } = useLocation()
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')

  // Nav solo visible en pantallas de inicio, no en editores (/preventivos/:id, /att/:id, etc.)
  const homeScreens = isTecnico
    ? ['/', '/admin', '/mi-inventario']
    : ['/', '/admin', ...modules.map((m) => m.indexPath)]
  const showNav = homeScreens.includes(pathname)

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <span className="text-xl">📡</span>
        <span className="font-bold text-base tracking-tight flex-1">TelecomCatalog</span>
        <UserMenu />
        <span className="text-[10px] font-mono text-slate-500 leading-tight text-right shrink-0">
          <span className="text-brand-400 font-semibold">{__APP_VERSION__}</span>
          <br />
          <span title="build">{buildStamp}</span>
        </span>
      </header>
      <OfflineBanner />
      <main className="flex-1 overflow-y-auto px-4 py-4">{children}</main>
      {showNav && (
        <nav className="bg-slate-900 border-t border-slate-800 flex sticky bottom-0 z-30">
          {isTecnico ? (
            <>
              <NavLink to="/" end
                className={({ isActive }) => `flex-1 flex flex-col items-center py-2 text-[11px] font-medium transition-colors ${isActive ? 'text-brand-400' : 'text-slate-500 hover:text-slate-300'}`}>
                <span className="text-xl mb-0.5">📋</span>
                Asignaciones
              </NavLink>
              <NavLink to="/mi-inventario"
                className={({ isActive }) => `flex-1 flex flex-col items-center py-2 text-[11px] font-medium transition-colors ${isActive ? 'text-brand-400' : 'text-slate-500 hover:text-slate-300'}`}>
                <span className="text-xl mb-0.5">📦</span>
                Inventario
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/" end
                className={({ isActive }) => `flex-1 flex flex-col items-center py-2 text-[11px] font-medium transition-colors ${isActive ? 'text-brand-400' : 'text-slate-500 hover:text-slate-300'}`}>
                <span className="text-xl mb-0.5">🏠</span>
                Inicio
              </NavLink>
              {modules.map((mod) => (
                <NavLink key={mod.id} to={mod.indexPath}
                  className={({ isActive }) => `flex-1 flex flex-col items-center py-2 text-[11px] font-medium transition-colors ${isActive ? 'text-brand-400' : 'text-slate-500 hover:text-slate-300'}`}>
                  <span className="text-xl mb-0.5">{mod.icon}</span>
                  {mod.name}
                </NavLink>
              ))}
            </>
          )}
        </nav>
      )}
    </div>
  )
}
