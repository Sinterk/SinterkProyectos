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
import { anularMovimiento, getResumenProyecto, listMateriales, listMovimientos, listNombresPuntos, listObservaciones, listUbicaciones, TIPO_LABELS_MOV } from '@/lib/inventario/inventarioRepo'
import type { Movimiento } from '@/lib/inventario/types'
import { AsignacionesForm } from '@/modules/inventario/components/AsignacionesForm'
import { generarHojaLogistica } from './generarHojaLogistica'
import { ResumenProyectoTable } from './ResumenProyectoTable'
import { ObservacionesSection } from './ObservacionesSection'

interface Punto { id: string; nombre: string }

interface Props {
  projectId: string
  area: 'ATT' | 'OyM'
  puntos?: Punto[]
  /** Sin `puntos`, igual junta las filas de todos los puntos por material (vista de incidencia enlazada a un cuadrante: el detalle por punto se edita en Preventivos). */
  agregarPuntos?: boolean
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
  /** Título corto del proyecto para la Hoja de logística en PDF — ej. "OTT 72603688266". Si no se pasa, no se ofrece imprimir. */
  tituloHoja?: string
  /** Datos generales (los de arriba del editor, encima de las pestañas) para la Hoja de logística en PDF. */
  datosGeneralesHoja?: { label: string; value: string }[]
  /** Fecha(s) para la esquina superior derecha de la Hoja de logística — 1 o 2 (ATT: inicio/término). */
  fechasHoja?: { label: string; value: string }[]
}

export function LogisticaTab({
  projectId, area, puntos, agregarPuntos, incluirComentarios = true, ott, direccion, fechaInicio, tituloHoja, datosGeneralesHoja, fechasHoja,
}: Props) {
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')
  // EquipoSection y ResumenProyectoTable leen `project_members` cada uno por
  // su cuenta (listas separadas, sin estado compartido) — sin este contador,
  // asignar un técnico acá no se reflejaba en el selector de "+ Nuevo
  // material" hasta salir y volver a entrar a la OTT.
  const [membersVersion, setMembersVersion] = useState(0)
  // La tabla de resumen y la lista de movimientos cargan por separado: cada
  // una avisa a la otra cuando cambia algo (anular un movimiento actualiza la
  // tabla; guardar en la tabla actualiza los movimientos).
  const [resumenKey, setResumenKey] = useState(0)
  const [movimientosKey, setMovimientosKey] = useState(0)
  return (
    <div className="space-y-4">
      {!isTecnico && (
        <EquipoSection projectId={projectId} onMembersChanged={() => setMembersVersion((v) => v + 1)} />
      )}
      {!isTecnico && tituloHoja && (
        <HojaLogisticaButton projectId={projectId} titulo={tituloHoja}
          datosGenerales={datosGeneralesHoja ?? []} fechas={fechasHoja ?? []} />
      )}
      <ResumenProyectoTable projectId={projectId} area={area} puntos={puntos} agregarPuntos={agregarPuntos} membersVersion={membersVersion}
        refreshKey={resumenKey} onChanged={() => setMovimientosKey((k) => k + 1)}
        ott={ott} direccion={direccion} fechaInicio={fechaInicio} />
      {!isTecnico && area === 'OyM' && <AsignacionMaterialSection />}
      {!isTecnico && <MovimientosProyectoSection projectId={projectId} puntos={puntos} refreshKey={movimientosKey} onAnulado={() => setResumenKey((k) => k + 1)} />}
      {incluirComentarios && <ObservacionesSection projectId={projectId} />}
    </div>
  )
}

/**
 * "Hoja de logística" imprimible (PDF) — pedido de Andrés: los técnicos ya
 * salen con el plano impreso, falta un papel donde puedan firmar el
 * retiro/instalación de material (ver docs/CONTINUAR-BACKEND.md). Junta lo
 * mismo que ya se ve en esta pantalla (técnicos, tabla de material,
 * observaciones) más espacio en blanco para escribir a mano y una tabla de
 * firmas compacta (una fila por técnico, salida e instalado lado a lado —
 * pensada para caber en 1 sola hoja). No requiere red aparte de lo que esta
 * pestaña ya cargó — usa las mismas funciones de repo.
 */
function HojaLogisticaButton({ projectId, titulo, datosGenerales, fechas }: {
  projectId: string; titulo: string; datosGenerales: { label: string; value: string }[]; fechas: { label: string; value: string }[]
}) {
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generar() {
    setGenerando(true)
    setError(null)
    try {
      const [members, resumen, observaciones, materiales, bodegas] = await Promise.all([
        adminRepo.listMembers(projectId),
        getResumenProyecto(projectId),
        listObservaciones(projectId, null),
        listMateriales(),
        listUbicaciones({ tipo: 'bodega' }),
      ])
      // Apodo en vez de descripción cuando existe — mismo criterio que
      // MaterialSelect en toda la app. getResumenProyecto no trae el apodo
      // (solo sku/descripción), así que se resuelve acá con el catálogo.
      const apodoPorMaterial = new Map(materiales.map((m) => [m.id, m.apodo]))
      const nombreBodega = new Map(bodegas.map((b) => [b.id, b.nombre]))
      await generarHojaLogistica({
        titulo,
        datosGenerales,
        fechas,
        tecnicos: members.map((m) => m.nombre?.trim() || m.email || ''),
        material: resumen.map((r) => ({
          descripcion: apodoPorMaterial.get(r.materialId) || r.materialDescripcion, lote: r.lote,
          origen: r.ubicacionBodegaId ? (nombreBodega.get(r.ubicacionBodegaId) ?? '') : '',
          entregado: r.cantEntregada, instalado: r.cantInstalada,
          devuelto: r.cantDevuelta, merma: r.cantMerma,
        })),
        observaciones: observaciones.map((o) => `${o.texto} — ${o.usuarioNombre ?? 'Alguien'}, ${new Date(o.createdAt).toLocaleDateString('es-CL')}`),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-white">🖨️ Hoja de logística</p>
        <p className="text-[11px] text-slate-500 mt-0.5">PDF imprimible para que los técnicos firmen la salida y el cierre de materiales.</p>
        {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
      </div>
      <button type="button" disabled={generando} onClick={() => { generar().catch(() => {}) }}
        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-xl shrink-0 whitespace-nowrap">
        {generando ? 'Generando…' : 'Generar PDF'}
      </button>
    </div>
  )
}

/**
 * Asignar material a un técnico (preventivo, sin proyecto) sin salir de la
 * incidencia — antes solo se podía desde Inventario → Registro →
 * Asignaciones. Solo OyM: en ATT el material se asigna específicamente por
 * OTT (ver ResumenProyectoTable), acá en cambio lo normal es que el técnico
 * YA traiga material asignado de antes (ver ORIGEN_TECNICO en
 * ResumenProyectoTable) — pedido de Andrés: "deberán estar desde la ventana
 * de OyM las asignaciones de materiales a técnicos". Colapsado por defecto,
 * mismo criterio que Movimientos de esta OTT: no es algo que se consulte
 * cada vez que se abre la incidencia.
 */
function AsignacionMaterialSection() {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-3">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-brand-400 uppercase tracking-wide">
        <span>{abierto ? '▾' : '▸'} Asignar material a técnico</span>
      </button>
      {abierto && <AsignacionesForm />}
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
            // Elegir ya agrega — antes hacía falta elegir y además apretar
            // "+ Agregar" aparte (pedido de Andrés: que sea solo elegir).
            <select value={selectedId} disabled={!!busyUserId} onChange={(e) => add(e.target.value)}
              className="w-full bg-slate-700 text-white text-sm rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none disabled:opacity-60">
              <option value="">Elegir trabajador…</option>
              {disponibles.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre?.trim() || c.email} ({ROL_LABELS[c.rol]})</option>
              ))}
            </select>
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
function MovimientosProyectoSection({ projectId, puntos, refreshKey, onAnulado }: {
  projectId: string
  puntos?: Punto[]
  /** Sube cuando la tabla de resumen guardó movimientos nuevos — recarga la lista si ya estaba cargada. */
  refreshKey: number
  /** Tras anular un movimiento, para que la tabla de resumen se actualice sola. */
  onAnulado: () => void
}) {
  const rol = useAuth((s) => s.profile?.rol)
  const puedeAnular = rol === 'admin' || rol === 'jp' || rol === 'log'
  const [abierto, setAbierto] = useState(false)
  const [rows, setRows] = useState<Movimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [anulando, setAnulando] = useState<string | null>(null)

  // Nombre de cada punto para rotular el movimiento: de la lista que ya trae
  // la pantalla (Preventivos) o, si no la hay (incidencia enlazada a un
  // cuadrante), consultándolos por id.
  const [nombresPunto, setNombresPunto] = useState<Record<string, string>>({})

  async function reload() {
    try {
      const movs = await listMovimientos({ projectId })
      setRows(movs)
      const conocidos = new Set((puntos ?? []).map((p) => p.id))
      const faltan = [...new Set(movs.map((m) => m.puntoId).filter((id): id is string => !!id && !conocidos.has(id)))]
      if (faltan.length > 0) setNombresPunto(await listNombresPuntos(faltan).catch(() => ({})))
    }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { if (abierto && rows === null) reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [abierto])
  // Si la lista ya se había cargado, se refresca; si no, se carga al abrirla.
  useEffect(() => { if (refreshKey > 0) { if (abierto) reload(); else setRows(null) } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey])

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
      onAnulado()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnulando(null)
    }
  }

  // La columna Punto solo aparece si el proyecto maneja puntos (Preventivos) o
  // algún movimiento ya trae uno (incidencia enlazada a un cuadrante).
  const mostrarPunto = !!puntos || (rows ?? []).some((m) => !!m.puntoId)

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
                    {mostrarPunto && <th className="px-2 py-1.5 font-medium">Punto</th>}
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
                      <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                        {m.lote}
                        {m.soloFisico && <span title="Compra propia — no toca el stock digital de SAP" className="ml-1 text-amber-400">🏷️</span>}
                      </td>
                      {mostrarPunto && (
                        <td className="px-2 py-2 text-slate-300 whitespace-nowrap">
                          {m.puntoId ? (puntos?.find((p) => p.id === m.puntoId)?.nombre || nombresPunto[m.puntoId] || 'Punto') : <span className="text-slate-500">General</span>}
                        </td>
                      )}
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

