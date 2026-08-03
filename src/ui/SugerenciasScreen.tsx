// Sugerencias de mejora / reportes de problema — accesible desde el botón de
// usuario. Cualquiera puede enviar una; admin/jp/log ven todas y pueden
// marcar el estado (triage). Ver src/lib/sugerencias/*.

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { crearSugerencia, listSugerencias, actualizarEstadoSugerencia } from '@/lib/sugerencias/sugerenciasRepo'
import { SUGERENCIA_ESTADO_LABELS, type Sugerencia, type SugerenciaEstado } from '@/lib/sugerencias/types'

const ESTADO_BADGE: Record<SugerenciaEstado, string> = {
  pendiente: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  revisado: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  resuelto: 'bg-green-500/15 text-green-300 border-green-500/30',
}

const inputCls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none'

function formatFechaHora(iso: string): string {
  const d = new Date(iso)
  const fecha = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  return `${fecha} · ${hora}`
}

export function SugerenciasScreen() {
  const { profile } = useAuth()
  const puedeTriage = profile?.rol === 'admin' || profile?.rol === 'jp' || profile?.rol === 'log'

  const [items, setItems] = useState<Sugerencia[]>([])
  const [loading, setLoading] = useState(true)
  const [asunto, setAsunto] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  async function cargar() {
    setLoading(true)
    try {
      setItems(await listSugerencias())
    } catch (err) {
      console.error('[SugerenciasScreen] listSugerencias:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  async function enviar() {
    setMsg(null)
    if (!asunto.trim() || !cuerpo.trim()) {
      setMsg({ text: 'Completa el asunto y la descripción.' })
      return
    }
    setEnviando(true)
    try {
      await crearSugerencia({ asunto: asunto.trim(), cuerpo: cuerpo.trim() })
      setAsunto('')
      setCuerpo('')
      setMsg({ ok: true, text: 'Enviado. ¡Gracias!' })
      await cargar()
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'No se pudo enviar.' })
    } finally {
      setEnviando(false)
    }
  }

  async function cambiarEstado(id: string, estado: SugerenciaEstado) {
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, estado } : s)))
    try {
      await actualizarEstadoSugerencia(id, estado)
    } catch (err) {
      console.error('[SugerenciasScreen] actualizarEstado:', err)
      await cargar()
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Sugerencias de mejora</h1>
        <p className="text-sm text-slate-400 mt-1">
          Reporta un problema o propone una mejora. Se envía con tu nombre, fecha y hora.
        </p>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Asunto</label>
          <input
            className={inputCls}
            placeholder="Ej: problema encontrado en Preventivos"
            value={asunto}
            onChange={(e) => setAsunto(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium">Descripción</label>
          <textarea
            className={`${inputCls} min-h-[100px] resize-y`}
            placeholder="Describe qué pasó o qué mejorarías…"
            value={cuerpo}
            onChange={(e) => setCuerpo(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={enviar}
            disabled={enviando}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
          {msg && <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">
          {puedeTriage ? 'Todas las sugerencias' : 'Tus sugerencias'}
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay sugerencias.</p>
        ) : (
          items.map((s) => (
            <div key={s.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{s.asunto}</p>
                  <p className="text-[11px] text-slate-500">
                    {formatFechaHora(s.createdAt)}
                    {puedeTriage && (s.usuarioNombre || s.usuarioEmail) && ` · ${s.usuarioNombre || s.usuarioEmail}`}
                  </p>
                </div>
                {puedeTriage ? (
                  <select
                    value={s.estado}
                    onChange={(e) => cambiarEstado(s.id, e.target.value as SugerenciaEstado)}
                    className={`text-[11px] font-semibold rounded-full px-2 py-1 border bg-transparent ${ESTADO_BADGE[s.estado]}`}
                  >
                    {(Object.keys(SUGERENCIA_ESTADO_LABELS) as SugerenciaEstado[]).map((e) => (
                      <option key={e} value={e} className="bg-slate-800 text-white">
                        {SUGERENCIA_ESTADO_LABELS[e]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-1 border ${ESTADO_BADGE[s.estado]}`}>
                    {SUGERENCIA_ESTADO_LABELS[s.estado]}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{s.cuerpo}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
