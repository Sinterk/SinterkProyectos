// Material instalado en UN punto específico — vive dentro de PuntoCard, no en
// la pestaña Logística. Reusa getResumenProyecto (ya trae puntoId por fila,
// filtramos client-side) y registrarMovimiento con tipoUI='instalado' +
// puntoId (mismo camino que ya usa ResumenProyectoTable, sin RPC nueva).

import { useEffect, useState } from 'react'
import { adminRepo } from '@/lib/adminRepo'
import type { MemberProfile } from '@/lib/adminRepo'
import { useAuth } from '@/lib/auth'
import { nanoid } from '@/core/utils/nanoid'
import { reemplazarLineaPorVarias } from '@/core/utils/lineas'
import { getResumenProyecto, listMateriales, registrarMovimiento } from '@/lib/inventario/inventarioRepo'
import type { Material, ResumenMaterialProyecto } from '@/lib/inventario/types'
import { MaterialSelect } from '@/ui/MaterialSelect'

interface Props {
  projectId: string
  puntoId: string
}

interface Linea {
  localId: string
  materialId: string
  cantidad: string
}

function emptyLinea(): Linea {
  return { localId: nanoid(8), materialId: '', cantidad: '' }
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

  // Varias líneas (no solo una) porque un paquete de materiales (Catálogo →
  // Paquetes de materiales) agrega un SKU por línea de una vez, sin
  // cantidad — el técnico completa cada una a mano antes de registrar. Sin
  // esto, elegir el paquete no tendría dónde meter los otros SKU.
  const [lineas, setLineas] = useState<Linea[]>([emptyLinea()])
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

  function updateLinea(localId: string, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)))
  }
  function addLinea() {
    setLineas((prev) => [...prev, emptyLinea()])
  }
  function removeLinea(localId: string) {
    setLineas((prev) => (prev.length > 1 ? prev.filter((l) => l.localId !== localId) : prev))
  }
  /** Paquete elegido en la línea `localId`: la reemplaza por una línea por SKU, todas sin cantidad. */
  function handlePaqueteSeleccionado(localId: string, materialIds: string[]) {
    const nuevas = materialIds.map((materialId) => ({ localId: nanoid(8), materialId, cantidad: '' }))
    setLineas((prev) => reemplazarLineaPorVarias(prev, localId, nuevas))
  }

  const lineasValidas = lineas.filter((l) => l.materialId && Number(l.cantidad) > 0)
  const puedeAgregar = lineasValidas.length > 0 && !!tecnicoUserId

  async function agregar() {
    if (!puedeAgregar) return
    setBusy(true)
    setError(null)
    setAviso(null)
    try {
      let algunaRequiereRevision = false
      for (const l of lineasValidas) {
        const r = await registrarMovimiento({
          tipoUI: 'instalado', materialId: l.materialId, cantidad: Number(l.cantidad), projectId, puntoId, tecnicoUserId,
        })
        if (r.requiereRevision) algunaRequiereRevision = true
      }
      if (algunaRequiereRevision && !isTecnico) {
        setAviso('⚠️ Sin stock suficiente del material en el proyecto ni en el equipo asignado — se registró igual y queda para revisión.')
      }
      setLineas([emptyLinea()])
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

      <div className="space-y-1.5">
        {lineas.map((l) => (
          <div key={l.localId} className="flex flex-wrap gap-1.5">
            <MaterialSelect materiales={materiales} value={l.materialId}
              onChange={(id) => updateLinea(l.localId, { materialId: id, cantidad: '' })}
              onSelectPaquete={(materialIds) => handlePaqueteSeleccionado(l.localId, materialIds)}
              className="flex-1 min-w-[140px]" />
            <input type="number" min="0" step="any" placeholder="Cant." value={l.cantidad}
              onChange={(e) => updateLinea(l.localId, { cantidad: e.target.value })}
              className="w-16 bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none" />
            <button type="button" onClick={() => removeLinea(l.localId)} disabled={lineas.length === 1}
              className="shrink-0 px-2 text-xs text-red-400 disabled:opacity-30">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={addLinea} className="text-xs text-brand-400 font-semibold">+ Agregar línea</button>
          <select value={tecnicoUserId} onChange={(e) => setTecnicoUserId(e.target.value)}
            className="bg-slate-700 text-white text-xs rounded-lg px-2 py-1.5 border border-slate-600 focus:border-brand-500 focus:outline-none">
            <option value="">Técnico…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nombre?.trim() || m.email}</option>)}
          </select>
          <button type="button" disabled={busy || !puedeAgregar} onClick={agregar}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-semibold">
            {busy ? 'Registrando…' : '+ Agregar'}
          </button>
        </div>
      </div>
    </div>
  )
}
