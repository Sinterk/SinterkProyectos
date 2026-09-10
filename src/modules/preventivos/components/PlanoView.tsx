import { useParams, useNavigate } from 'react-router-dom'
import { usePreventivoStore } from '../store'
import { useRestorePhotoPreviews } from '../hooks/useRestorePhotoPreviews'
import type { FotoKey } from '../types'

const LABELS: Record<FotoKey, string> = { fotoLevantamiento:'Levantamiento', fotoAntes:'Antes', fotoDespues:'Después' }
const COLORS: Record<FotoKey, string> = { fotoLevantamiento:'border-blue-400', fotoAntes:'border-orange-400', fotoDespues:'border-green-400' }
const KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

export function PlanoView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const record = usePreventivoStore((s) => s.records[id ?? ''])
  useRestorePhotoPreviews(id ?? '')

  if (!record) return <div className="text-slate-400 text-center py-16">No encontrado.</div>

  const { cuadrante, puntos } = record
  const conFoto = puntos.filter((p) => p.fotoLevantamiento || p.fotoAntes || p.fotoDespues)

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="text-slate-400 hover:text-white text-sm">← Volver</button>
        <h1 className="text-sm font-bold text-white flex-1 truncate">
          📐 Vista por plano — {cuadrante.cuadrante || '?'}{cuadrante.comuna ? ` · ${cuadrante.comuna}` : ''}
        </h1>
      </div>

      {cuadrante.fotoPlano?.previewUrl ? (
        <div className="rounded-2xl overflow-hidden border border-slate-700 bg-slate-900">
          <div className="px-3 py-2 text-xs font-semibold text-brand-400 border-b border-slate-700">📐 Plano de trabajo</div>
          <img src={cuadrante.fotoPlano.previewUrl} alt="Plano" className="w-full max-h-80 object-contain" />
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-800/50 p-8 text-center">
          <div className="text-4xl mb-2">📐</div>
          <p className="text-slate-500 text-sm">Sin foto de plano. Agrégala desde el editor.</p>
        </div>
      )}

      <div className="bg-slate-800 rounded-2xl border border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Puntos con fotos</span>
          <span className={`text-xs font-semibold ${conFoto.length === puntos.length && puntos.length > 0 ? 'text-green-400' : 'text-brand-400'}`}>
            {conFoto.length}/{puntos.length}
          </span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full" style={{ width: puntos.length > 0 ? `${(conFoto.length/puntos.length)*100}%` : '0%' }} />
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {puntos.map((p, i) => {
            const ok = p.fotoLevantamiento || p.fotoAntes || p.fotoDespues
            return <span key={p.id} className={`text-xs px-2 py-0.5 rounded-full ${ok ? 'bg-brand-700 text-brand-200' : 'bg-slate-700 text-slate-400'}`}>{p.nombre||`P${i+1}`}</span>
          })}
        </div>
      </div>

      {conFoto.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">No hay fotos aún.</div>
      ) : (
        <div className="space-y-4">
          {conFoto.map((punto) => {
            const idx = puntos.indexOf(punto)
            return (
              <div key={punto.id} className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-700">
                  <span className="bg-brand-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">{idx+1}</span>
                  <span className="text-sm font-medium text-white">{punto.nombre||`Punto ${idx+1}`}</span>
                  {punto.direccion && <span className="text-xs text-slate-500 truncate ml-1">— {punto.direccion}</span>}
                </div>
                <div className="p-3 grid grid-cols-3 gap-2">
                  {KEYS.map((key) => {
                    const foto = punto[key]
                    return foto?.previewUrl ? (
                      <div key={key} className={`rounded-xl overflow-hidden border-2 ${COLORS[key]}`}>
                        <img src={foto.previewUrl} alt={LABELS[key]} loading="lazy" className="w-full h-28 object-cover" />
                        <div className="bg-black/60 px-1.5 py-0.5 text-[10px] text-white text-center">{LABELS[key]}</div>
                      </div>
                    ) : (
                      <div key={key} className={`rounded-xl border-2 border-dashed ${COLORS[key]} h-28 flex items-center justify-center`}>
                        <span className="text-[10px] text-slate-600">{LABELS[key]}</span>
                      </div>
                    )
                  })}
                </div>
                {(punto.descripcion||punto.correccion) && (
                  <div className="px-4 pb-3 space-y-1">
                    {punto.descripcion && <p className="text-xs text-slate-400">{punto.descripcion}</p>}
                    {punto.correccion && <p className="text-xs text-amber-400">⚠ {punto.correccion}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
