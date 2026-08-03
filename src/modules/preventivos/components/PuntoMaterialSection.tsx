// Material instalado en UN punto específico — vive dentro de PuntoCard, no en
// la pestaña Logística. Reusa getResumenProyecto (ya trae puntoId por fila,
// filtramos client-side) y registrarMovimiento con tipoUI='instalado' +
// puntoId (mismo camino que ya usa ResumenProyectoTable, sin RPC nueva).

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import { getResumenProyecto, listMateriales, registrarMovimiento } from '@/lib/inventario/inventarioRepo'
import type { Material, ResumenMaterialProyecto } from '@/lib/inventario/types'
import { MaterialSelect } from '@/ui/MaterialSelect'

interface Props {
  projectId: string
  puntoId: string
}

export function PuntoMaterialSection({ projectId, puntoId }: Props) {
  const session = useAuth((s) => s.session)
  // El aviso de "sin stock, se registró en negativo" es para que oficina lo
  // resuelva (ver eventos_inventario) — desde terreno solo se registra lo
  // instalado, sin mostrar ese manejo.
  const isTecnico = useAuth((s) => s.profile?.rol === 'tecnico')
  const [materiales, setMateriales] = useState<Material[]>([])
  const [members, setMembers] = useState<MemberProfile[]>([])
  const [filas, setFilas] = useState<ResumenMaterialProyecto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [materialId, setMaterialId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [tecnicoUserId, setTecnicoUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  async function reload() {
    try { setFilas(await getResumenProyecto(projectId)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])
  useEffect(() => { listMateriales().then(setMateriales).catch(() => {}) }, [])
  useEffect(() => { adminRepo.listMembers(projectId).then(setMembers).catch(() => {}) }, [projectId])

  // Por defecto, el técnico logueado si está asignado al proyecto; si no, el primero del equipo.
  useEffect(() => {
    if (tecnicoUserId || members.length === 0) return
    const propio = members.find((m) => m.id === session?.user.id)
    setTecnicoUserId(propio?.id ?? members[0].id)
  }, [members, tecnicoUserId, session])

  const filasPunto = (filas ?? []).filter((f) => f.puntoId === puntoId && f.cantInstalada > 0)

  async function agregar() {
    const n = Number(cantidad)
    if (!materialId || !(n > 0) || !tecnicoUserId) return
    setBusy(true)
    setError(null)
    setAviso(null)
    try {
      const r = await registrarMovimiento({
        tipoUI: 'instalado', materialId, cantidad: n, projectId, puntoId, tecnicoUserId,
      })
      if (r.requiereRevision && !isTecnico) {
        setAviso('⚠️ Sin stock suficiente del material en el proyecto ni en el equipo asignado — se registró igual y queda para revisión.')
      }
      setMaterialId('')
      setCantidad('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-400">Material instalado en este punto</label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {aviso && <p className="text-xs text-amber-400">{aviso}</p>}

      {filasPunto.length > 0 && (
        <div className="space-y-1">
          {filasPunto.map((f) => (
            <div key={`${f.materialId}|${f.lote}`} className="flex items-center justify-between bg-slate-700/40 rounded-lg px-2 py-1.5 text-xs">
              <span className="text-slate-200">{f.materialSku} · {f.materialDescripcion}</span>
              <span className="text-white font-medium">{f.cantInstalada}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <MaterialSelect materiales={materiales} value={materialId} onChange={setMaterialId} className="flex-1 min-w-[140px]" />
        <input type="number" min="0" step="any" placeholder="Cant." value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="w-16 bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
        <select value={tecnicoUserId} onChange={(e) => setTecnicoUserId(e.target.value)}
          className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
          <option value="">Técnico…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
        </select>
        <button type="button" disabled={busy || !materialId || !(Number(cantidad) > 0) || !tecnicoUserId} onClick={agregar}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-semibold">
          + Agregar
        </button>
      </div>
    </div>
  )
}
