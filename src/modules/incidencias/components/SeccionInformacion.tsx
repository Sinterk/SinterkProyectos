import { useIncidenciaStore } from '../store'
import { useAuth } from '@/lib/auth'
import type { Incidencia } from '../types'

interface Props { record: Incidencia }

const inputCls = 'w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none'
const labelCls = 'text-[11px] text-slate-400'

/**
 * A pedido explícito del usuario, el técnico no debe tocar Información (la
 * llena Oficina/Admin al crear la incidencia) — se le muestra de solo
 * lectura, mismo espíritu que EstadoProyectoBadge (badge fijo si no puede
 * cambiar el estado).
 */
export function SeccionInformacion({ record }: Props) {
  const update = useIncidenciaStore((s) => s.update)
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')

  if (isTecnico) {
    return (
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Información</h2>
        <InfoRow label="Código incidencia" value={record.codigo} />
        <InfoRow label="Ingeniero" value={record.ingeniero} />
        <InfoRow label="Dirección" value={record.direccion} />
      </div>
    )
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Información</h2>
      <label className="space-y-1 block">
        <span className={labelCls}>Código incidencia *</span>
        <input value={record.codigo} onChange={(e) => update(record.id, { codigo: e.target.value })} className={inputCls} />
      </label>
      <label className="space-y-1 block">
        <span className={labelCls}>Ingeniero</span>
        <input value={record.ingeniero} onChange={(e) => update(record.id, { ingeniero: e.target.value })} className={inputCls} />
      </label>
      <label className="space-y-1 block">
        <span className={labelCls}>Dirección</span>
        <input value={record.direccion} onChange={(e) => update(record.id, { direccion: e.target.value })} className={inputCls} />
      </label>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <p className="text-sm text-white">{value || '—'}</p>
    </div>
  )
}
