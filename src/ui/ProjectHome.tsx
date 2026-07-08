import { useNavigate } from 'react-router-dom'
import { registry } from '@/core/registry/projectRegistry'

const COMING_SOON = [
  {
    id: 'incidencias',
    name: 'Incidencias',
    icon: '🚨',
    description: 'Registro y seguimiento de incidentes OyM',
  },
]

export function ProjectHome() {
  const navigate = useNavigate()
  const modules = registry.getAll()

  return (
    <div className="space-y-6 py-2">
      <div>
        <h1 className="text-xl font-bold text-white">¿En qué vas a trabajar?</h1>
        <p className="text-sm text-slate-400 mt-1">Selecciona el tipo de proyecto</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Módulos activos */}
        {modules.map((mod) => (
          <button
            key={mod.id}
            type="button"
            onClick={() => navigate(mod.indexPath)}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-brand-500 rounded-2xl p-5 text-left transition-colors group"
          >
            <div className="text-5xl mb-3">{mod.icon}</div>
            <div className="text-base font-bold text-white group-hover:text-brand-400 transition-colors">{mod.name}</div>
            <div className="text-sm text-slate-400 mt-1 leading-relaxed">{mod.description}</div>
          </button>
        ))}

        {/* Módulos próximos */}
        {COMING_SOON.map((mod) => (
          <div
            key={mod.id}
            className="relative group rounded-2xl p-5 border border-dashed border-slate-700 bg-slate-800/40 cursor-not-allowed select-none"
          >
            {/* Overlay EN PROCESO */}
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/75 backdrop-blur-[2px]">
              <span className="text-amber-400 font-bold text-sm tracking-[0.2em] uppercase border border-amber-400/40 px-4 py-1.5 rounded-full">
                EN PROCESO
              </span>
            </div>

            <div className="text-5xl mb-3 opacity-30">{mod.icon}</div>
            <div className="text-base font-bold text-slate-600">{mod.name}</div>
            <div className="text-sm text-slate-700 mt-1 leading-relaxed">{mod.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
