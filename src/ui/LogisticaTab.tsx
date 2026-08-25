// Pestaña "Logística" compartida por ATT y Preventivos: equipo asignado al
// proyecto, resumen/alta de material en una sola tabla (ver
// ResumenProyectoTable — "+ Nuevo material" reemplaza al formulario aparte
// que vivía acá), y observaciones libres. El rol técnico ve una versión
// reducida: solo Material y Observaciones (sin equipo asignado) — edita
// instalado/devuelto directo en la tabla de Material (ResumenProyectoTable
// ya restringe qué campos son editables por rol).

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import type { Profile } from '@/lib/auth'
import { useAuth, ROL_LABELS } from '@/lib/auth'
import { anularMovimiento, listMovimientos, TIPO_LABELS_MOV } from '@/lib/inventario/inventarioRepo'
import type { Movimiento } from '@/lib/inventario/types'
import { ResumenProyectoTable } from './ResumenProyectoTable'
import { ObservacionesSection } from './ObservacionesSection'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  area: 'ATT' | 'OyM'
  puntos?: Punto[]
  /** Incidencias tiene su propia pestaña "Comentarios" separada — evita duplicar ObservacionesSection acá. Default true (ATT/Preventivos sin cambios). */
  incluirComentarios?: boolean
  /**
   * Solo ATT las pasa hoy — se usan para armar el formato de "Material
   * digital" copiable al control de rebajas de Entel (OTT/Dirección/Fecha
   * de instalación por fila, ver ResumenProyectoTable). Preventivos/
   * Incidencias las dejan vacías, sin romper nada — esas columnas quedan en
   * blanco si no aplica.
   */
  ott?: string
  direccion?: string
  fechaInicio?: string
}

export function LogisticaTab({ projectId, area, puntos, incluirComentarios = true, ott, direccion, fechaInicio }: Props) {
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')
  // EquipoSection y ResumenProyectoTable leen `project_members` cada uno por
  // su cuenta (listas separadas, sin estado compartido) — sin este contador,
  // asignar un técnico acá no se reflejaba en el selector de "+ Nuevo
  // material" hasta salir y volver a entrar a la OTT.
  const [membersVersion, setMembersVersion] = useState(0)
  return (
    <div className="space-y-4">
      {!isTecnico && (
        <EquipoSection projectId={projectId} onMembersChanged={() => setMembersVersion((v) => v + 1)} />
      )}
      <ResumenProyectoTable projectId={projectId} area={area} puntos={puntos} membersVersion={membersVersion}
        ott={ott} direccion={direccion} fechaInicio={fechaInicio} />
      {!isTecnico && <MovimientosProyectoSection projectId={projectId} />}
      {incluirComentarios && <ObservacionesSection projectId={projectId} />}
    </div>
  )
}

function EquipoSection({ projectId, onMembersChanged }: { projectId: string; onMembersChanged: () => void }) {
  const [members, setMembers] = useState<MemberProfile[] | null>(null)
  const [candidates, setCandidates] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')

  async function reload() {
    try { setMembers(await adminRepo.listMembers(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  useEffect(() => {
    reload()
    // Cualquier trabajador activo, sin importar su área/rol (antes solo
    // Terreno y Logística) — pedido explícito: hay gente de Oficina que
    // también se asigna a una OTT. El rol sigue mostrándose entre paréntesis
    // en la lista para saber de qué área es cada uno.
    adminRepo.listProfiles()
      .then((all) => setCandidates(all.filter((p) => p.activo)))
      .catch(() => {})
  }, [projectId])

  async function add(userId: string) {
    if (!userId) return
    setBusyUserId(userId)
    setError(null)
    try {
      await adminRepo.addMember(projectId, userId)
      await reload()
      onMembersChanged()
      setSelectedId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  async function remove(userId: string) {
    setBusyUserId(userId)
    setError(null)
    try {
      await adminRepo.removeMember(projectId, userId)
      await reload()
      onMembersChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyUserId(null)
    }
  }

  // Con la planilla real de personal cargada (30+ técnicos), un checklist con
  // todos a la vista dejó de ser práctico — se reemplaza por la lista de ya
  // asignados (quitar con ×) + un desplegable de los que faltan + "Agregar".
  const disponibles = candidates.filter((c) => !members?.some((m) => m.id === c.id))

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">Técnicos asignados</h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {members === null ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : (
        <>
          {members.length === 0 ? (
            <p className="text-xs text-slate-500">Nadie asignado todavía.</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => {
                const c = candidates.find((cc) => cc.id === m.id)
                return (
                  <div key={m.id} className="flex items-center justify-between gap-2 bg-slate-700/50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-slate-200 truncate">
                      {m.nombre?.trim() || m.email}
                      {c && <span className="text-slate-500 text-xs"> ({ROL_LABELS[c.rol]})</span>}
                    </span>
                    <button type="button" onClick={() => remove(m.id)} disabled={busyUserId === m.id}
                      className="text-slate-500 hover:text-red-400 text-base leading-none shrink-0 disabled:opacity-40">
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {disponibles.length === 0 ? (
            members.length === 0 && <p className="text-xs text-slate-500">No hay trabajadores registrados todavía.</p>
          ) : (
            <div className="flex gap-2">
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
                className="flex-1 min-w-0 bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
                <option value="">Elegir trabajador…</option>
                {disponibles.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre?.trim() || c.email} ({ROL_LABELS[c.rol]})</option>
                ))}
              </select>
              <button type="button" onClick={() => add(selectedId)} disabled={!selectedId || busyUserId === selectedId}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold">
                + Agregar
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Movimientos de ESTA OTT, con "Anular" ahí mismo — antes había que ir a la
 * pestaña Movimientos de Inventario y buscar el proyecto ahí (Andrés:
 * "para no tener que andar buscando en movimientos"). Mismo `anularMovimiento`
 * y mismo aviso de `requiereRevision` que esa pestaña — ver Home.tsx
 * (MovimientosTab). Colapsado por defecto: es una herramienta de auditoría,
 * no algo que se consulte en cada entrada a la OTT.
 */
function MovimientosProyectoSection({ projectId }: { projectId: string }) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeAnular = rol === 'admin' || rol === 'jp' || rol === 'log'
  const [abierto, setAbierto] = useState(false)
  const [rows, setRows] = useState<Movimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [anulando, setAnulando] = useState<string | null>(null)

  async function reload() {
    try { setRows(await listMovimientos({ projectId })) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { if (abierto && rows === null) reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [abierto])

  async function handleAnular(m: Movimiento) {
    const detalle = `${TIPO_LABELS_MOV[m.tipo] ?? m.tipo} — ${m.materialSku} (${m.cantidad}) — ${m.fecha.slice(0, 10)}`
    const aviso = m.requiereRevision
      ? '\n\nOJO: este movimiento generó un evento de revisión. Al anularlo se borra ese evento y sus resoluciones. Lo que esas resoluciones movieron NO se revierte acá: cada una dejó su propio movimiento, y hay que anularlo por separado.'
      : ''
    if (!confirm(`¿Anular este movimiento?\n\n${detalle}\n\nEsto revierte el stock que movió y borra el registro. No se puede deshacer.${aviso}`)) return
    setAnulando(m.id)
    setError(null)
    try {
      await anularMovimiento(m.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnulando(null)
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-brand-400 uppercase tracking-wide">
        <span>{abierto ? '▾' : '▸'} Movimientos de esta OTT{rows ? ` (${rows.length})` : ''}</span>
      </button>
      {abierto && (
        <>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {rows === null ? (
            <p className="text-xs text-slate-500">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-500">Sin movimientos.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-700/50 text-slate-400 text-left divide-x divide-slate-700">
                    <th className="px-2 py-1.5 font-medium">Fecha</th>
                    <th className="px-2 py-1.5 font-medium">Tipo</th>
                    <th className="px-2 py-1.5 font-medium">SKU</th>
                    <th className="px-2 py-1.5 font-medium">Lote</th>
                    <th className="px-2 py-1.5 font-medium text-right">Cantidad</th>
                    <th className="px-2 py-1.5 font-medium">Bodega</th>
                    <th className="px-2 py-1.5 font-medium">Usuario</th>
                    <th className="px-2 py-1.5 font-medium">Nota</th>
                    {puedeAnular && <th className="px-2 py-1.5 font-medium">Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-t border-slate-700 divide-x divide-slate-700">
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.fecha.slice(0, 10)}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{TIPO_LABELS_MOV[m.tipo] ?? m.tipo}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.materialSku}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.lote}</td>
                      <td className="px-2 py-2 text-right font-semibold text-white whitespace-nowrap">{m.cantidad}</td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                        {m.ubicacionDestinoNombre ? `${m.ubicacionNombre} → ${m.ubicacionDestinoNombre}` : m.ubicacionNombre}
                      </td>
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">{m.usuarioNombre ?? '—'}</td>
                      <td className="px-2 py-2 max-w-[220px]"><p className="text-slate-400 truncate">{m.nota ?? '—'}</p></td>
                      {puedeAnular && (
                        <td className="px-2 py-2 whitespace-nowrap">
                          <button type="button" onClick={() => handleAnular(m)} disabled={anulando === m.id}
                            className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40">
                            {anulando === m.id ? 'Anulando…' : '🗑 Anular'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

