import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from '@/core/utils/nanoid'
import { useAuth } from '@/lib/auth'
import { attRepo, isUuid } from './data/attRepo'
import { uploadRecordPhotos } from './data/photoStorage'
import type {
  AttRecord, FotoEntry,
  TramoCable, Hito, InfraItem, Infraestructura,
} from './types'

export type RemoveResult =
  | { ok: true; mode: 'deleted' | 'closed' }
  | { ok: false; error: string }

/**
 * ¿Le falta a este record algo por sincronizar? Cubre dos casos: nunca llegó
 * al servidor (id sigue siendo el nanoid de creación local), o ya existe allá
 * pero le quedó una foto capturada localmente sin subir a Storage (p. ej. un
 * guardado anterior falló a medio camino). Lo usa el aviso de migración en
 * Home para saber qué informes ofrecer a sincronizar.
 */
export function hasPendingSync(record: AttRecord): boolean {
  if (!isUuid(record.id)) return true
  const pendingFoto = (f?: FotoEntry) => !!f?.blobId && !f.storagePath
  return pendingFoto(record.fotoAerea) || record.fotos.some(pendingFoto)
}

/**
 * Fusiona un record recién leído del servidor con lo que ya hay en cache:
 * - si lo local es más nuevo (edición en curso aún no sincronizada), se
 *   conserva lo local tal cual (evita pisar tipeo en curso con datos viejos).
 * - si el servidor gana, se preservan los `previewUrl`/`blobId` locales de
 *   las fotos que ya se habían resuelto (por storagePath), para no perder la
 *   miniatura y forzar un refetch de la signed URL sin necesidad.
 */
function mergeFromServer(local: AttRecord | undefined, server: AttRecord): AttRecord {
  if (local && local.updatedAt > server.updatedAt) return local

  const localAerea = local?.fotoAerea
  function mergeFoto(f: FotoEntry): FotoEntry {
    const prev = local?.fotos.find((lf) => lf.storagePath && lf.storagePath === f.storagePath)
      ?? (localAerea?.storagePath === f.storagePath ? localAerea : undefined)
    return prev ? { ...f, previewUrl: prev.previewUrl, blobId: prev.blobId } : f
  }

  return {
    ...server,
    fotoAerea: server.fotoAerea ? mergeFoto(server.fotoAerea) : undefined,
    fotos: server.fotos.map(mergeFoto),
  }
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyInfraItem(): InfraItem {
  return { usa: false, cantidad: '', compania: '' }
}

function emptyInfra(): Infraestructura {
  return {
    postesElectricos:  emptyInfraItem(),
    postesOtraTeleco:  emptyInfraItem(),
    ductosOtraTeleco:  emptyInfraItem(),
    fibraOtraCompania: { usa: false },
    postesEntel:       { usa: false },
  }
}

export function emptyAttRecord(id: string, now: number): AttRecord {
  return {
    id, createdAt: now, updatedAt: now,
    estado: 'activo',
    tipoProyecto: '',
    ott: '', nombreProyecto: '', iniciativa: '',
    ingenieroProyecto: '', jefeProyecto: '',
    comuna: '', region: 'Metropolitana', contratista: 'SINTERK',
    coordsInicio: { lat: '', lng: '' },
    coordsTermino: { lat: '', lng: '' },
    tramos: [{ id: nanoid(), tipoCable: '', metraje: '', desde: '', hasta: '' }],
    descripcionCabecera: '',
    instalaCMIC: false, instalaMufas: false,
    tieneIngresoRed: false, tieneReparacionDucto: false,
    ingresoRed: { nodo: '', rack: '', odf: '', fo: '' },
    hitos: [],
    infraestructura: emptyInfra(),
    fotos: [],
    fecha: todayISO(),
    codigoServicio: '',
    nombreServicio: '',
    tituloInforme: '',
  }
}

interface AttState {
  records: Record<string, AttRecord>
  /**
   * Última marca `updatedAt` de cada record que llegó del SERVIDOR (por
   * syncList/syncOne/rekey), no de una edición del usuario. `useAttAutosave`
   * la usa para no confundir "el store se refrescó desde Supabase" con "el
   * usuario tipeó algo" — si no se distinguiera, cada vez que se abre o
   * recarga un informe se dispararía un guardado (delete+insert de
   * tramos/fotos) sin que nadie haya editado nada.
   */
  syncedAt: Record<string, number>

  createNew: () => string
  /** Borra (admin) o cierra (jp/invitado) según lo que la RLS permita al rol actual. */
  remove: (id: string) => Promise<RemoveResult>
  /** Widget de estado del Editor (jp/admin): abrir/cerrar directo, sin pasar por `remove`. */
  setEstado: (id: string, estado: 'activo' | 'cerrado') => Promise<{ ok: true } | { ok: false; error: string }>
  update: (id: string, data: Partial<AttRecord>) => void

  /** Trae la lista del servidor y la fusiona en cache (Zustand = caché, Supabase = fuente). */
  syncList: () => Promise<void>
  /** Trae un informe puntual del servidor (deep-link / recarga en el Editor). */
  syncOne: (id: string) => Promise<void>
  /** Tras el primer guardado de un borrador local, reemplaza su id nanoid por el uuid del servidor. */
  rekey: (oldId: string, saved: AttRecord) => void
  /**
   * Sube las fotos pendientes y persiste el informe en Supabase (usado por el
   * autoguardado y por la migración manual de borradores locales). Si el id
   * era un borrador local, lo rekea y devuelve el record ya con el uuid.
   * Lanza si falla — quien llama decide cómo mostrar el error.
   */
  persistToServer: (id: string) => Promise<AttRecord>

  setFotoAereaStoragePath: (id: string, storagePath: string) => void
  setFotoStoragePath: (id: string, index: number, storagePath: string) => void

  addTramo: (id: string) => void
  removeTramo: (id: string, tramoId: string) => void
  updateTramo: (id: string, tramoId: string, data: Partial<Omit<TramoCable, 'id'>>) => void

  addHito: (id: string) => void
  removeHito: (id: string, hitoId: string) => void
  updateHito: (id: string, hitoId: string, data: Partial<Omit<Hito, 'id'>>) => void

  setFotoAerea: (id: string, entry: FotoEntry) => void
  removeFotoAerea: (id: string) => void
  setFotoAereaPreview: (id: string, previewUrl: string) => void

  addFoto: (id: string, entry: FotoEntry) => void
  removeFoto: (id: string, index: number) => void
  updateFoto: (id: string, index: number, data: Partial<FotoEntry>) => void
  setFotoPreview: (id: string, index: number, previewUrl: string) => void
}

function touch(rec: AttRecord, extra?: Partial<AttRecord>): AttRecord {
  return { ...rec, ...extra, updatedAt: Date.now() }
}

export const useAttStore = create<AttState>()(
  persist(
    (set, get) => ({
      records: {},
      syncedAt: {},

      createNew() {
        const id = nanoid()
        const now = Date.now()
        set((s) => ({ records: { ...s.records, [id]: emptyAttRecord(id, now) } }))
        return id
      },

      async remove(id) {
        function dropLocal() {
          set((s) => {
            const next = { ...s.records }
            delete next[id]
            return { records: next }
          })
        }

        // Borrador local, nunca llegó al servidor: no hay nada que borrar allá.
        if (!isUuid(id)) {
          dropLocal()
          return { ok: true, mode: 'deleted' }
        }

        const isAdmin = useAuth.getState().profile?.rol === 'admin'
        try {
          if (isAdmin) {
            await attRepo.remove(id)
            dropLocal()
            return { ok: true, mode: 'deleted' }
          } else {
            await attRepo.close(id)
            dropLocal() // se oculta de "activos"; sigue existiendo como cerrado en el servidor
            return { ok: true, mode: 'closed' }
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },

      async setEstado(id, estado) {
        if (!isUuid(id)) return { ok: false, error: 'Guarda el informe primero.' }
        try {
          if (estado === 'cerrado') await attRepo.close(id)
          else await attRepo.reopen(id)
          set((s) => {
            const rec = s.records[id]
            if (!rec) return s
            return { records: { ...s.records, [id]: { ...rec, estado, fechaCierre: estado === 'cerrado' ? todayISO() : undefined } } }
          })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },

      async syncList() {
        const serverRecords = await attRepo.list()
        set((s) => {
          const records = { ...s.records }
          const syncedAt = { ...s.syncedAt }
          for (const rec of serverRecords) {
            const before = records[rec.id]
            const merged = mergeFromServer(before, rec)
            records[rec.id] = merged
            if (merged.updatedAt !== before?.updatedAt) syncedAt[rec.id] = merged.updatedAt
          }
          return { records, syncedAt }
        })
      },

      async syncOne(id) {
        if (!isUuid(id)) return
        const rec = await attRepo.load(id)
        if (!rec) return
        set((s) => {
          const before = s.records[id]
          const merged = mergeFromServer(before, rec)
          const tookServer = merged.updatedAt !== before?.updatedAt
          return {
            records: { ...s.records, [rec.id]: merged },
            syncedAt: tookServer ? { ...s.syncedAt, [rec.id]: merged.updatedAt } : s.syncedAt,
          }
        })
      },

      rekey(oldId, saved) {
        set((s) => {
          const old = s.records[oldId]
          const next = { ...s.records }
          delete next[oldId]
          // Conserva previews/blobId locales de fotos ya capturadas (mismo orden que se guardó).
          const fotos = saved.fotos.map((f, i) => {
            const prev = old?.fotos[i]
            return prev ? { ...f, previewUrl: prev.previewUrl, blobId: prev.blobId } : f
          })
          const fotoAerea = saved.fotoAerea && old?.fotoAerea
            ? { ...saved.fotoAerea, previewUrl: old.fotoAerea.previewUrl, blobId: old.fotoAerea.blobId }
            : saved.fotoAerea
          next[saved.id] = { ...saved, fotos, fotoAerea }
          // El uuid recién asignado por el servidor no es una edición pendiente.
          return { records: next, syncedAt: { ...s.syncedAt, [saved.id]: saved.updatedAt } }
        })
      },

      async persistToServer(id) {
        const current = get().records[id]
        if (!current) throw new Error('persistToServer: el informe ya no está en el store local')

        const withPhotos = await uploadRecordPhotos(current)
        // Persistir los storagePath recién subidos ANTES de guardar, para que
        // un intento fallido no vuelva a re-subir fotos ya subidas.
        withPhotos.fotos.forEach((f, i) => {
          if (f.storagePath && f.storagePath !== current.fotos[i]?.storagePath) {
            get().setFotoStoragePath(id, i, f.storagePath)
          }
        })
        if (withPhotos.fotoAerea?.storagePath && withPhotos.fotoAerea.storagePath !== current.fotoAerea?.storagePath) {
          get().setFotoAereaStoragePath(id, withPhotos.fotoAerea.storagePath)
        }

        const saved = await attRepo.save(withPhotos)
        if (saved.id !== id) get().rekey(id, saved) // borrador local promovido a uuid del servidor
        return saved
      },

      setFotoAereaStoragePath(id, storagePath) {
        set((s) => {
          const rec = s.records[id]
          if (!rec?.fotoAerea) return s
          return { records: { ...s.records, [id]: { ...rec, fotoAerea: { ...rec.fotoAerea, storagePath } } } }
        })
      },

      setFotoStoragePath(id, index, storagePath) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const fotos = rec.fotos.map((f, i) => i === index ? { ...f, storagePath } : f)
          return { records: { ...s.records, [id]: { ...rec, fotos } } }
        })
      },

      update(id, data) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, data) } }
        })
      },

      addTramo(id) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const t: TramoCable = { id: nanoid(), tipoCable: '', metraje: '', desde: '', hasta: '' }
          return { records: { ...s.records, [id]: touch(rec, { tramos: [...rec.tramos, t] }) } }
        })
      },

      removeTramo(id, tramoId) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, { tramos: rec.tramos.filter((t) => t.id !== tramoId) }) } }
        })
      },

      updateTramo(id, tramoId, data) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const tramos = rec.tramos.map((t) => t.id === tramoId ? { ...t, ...data } : t)
          return { records: { ...s.records, [id]: touch(rec, { tramos }) } }
        })
      },

      addHito(id) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const h: Hito = { id: nanoid(), fecha: '', descripcion: '' }
          return { records: { ...s.records, [id]: touch(rec, { hitos: [...rec.hitos, h] }) } }
        })
      },

      removeHito(id, hitoId) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, { hitos: rec.hitos.filter((h) => h.id !== hitoId) }) } }
        })
      },

      updateHito(id, hitoId, data) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const hitos = rec.hitos.map((h) => h.id === hitoId ? { ...h, ...data } : h)
          return { records: { ...s.records, [id]: touch(rec, { hitos }) } }
        })
      },

      setFotoAerea(id, entry) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, { fotoAerea: entry }) } }
        })
      },

      removeFotoAerea(id) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, { fotoAerea: undefined }) } }
        })
      },

      setFotoAereaPreview(id, previewUrl) {
        set((s) => {
          const rec = s.records[id]
          if (!rec?.fotoAerea) return s
          return { records: { ...s.records, [id]: { ...rec, fotoAerea: { ...rec.fotoAerea, previewUrl } } } }
        })
      },

      addFoto(id, entry) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, { fotos: [...rec.fotos, entry] }) } }
        })
      },

      removeFoto(id, index) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return { records: { ...s.records, [id]: touch(rec, { fotos: rec.fotos.filter((_, i) => i !== index) }) } }
        })
      },

      updateFoto(id, index, data) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const fotos = rec.fotos.map((f, i) => i === index ? { ...f, ...data } : f)
          return { records: { ...s.records, [id]: touch(rec, { fotos }) } }
        })
      },

      setFotoPreview(id, index, previewUrl) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const fotos = rec.fotos.map((f, i) => i === index ? { ...f, previewUrl } : f)
          return { records: { ...s.records, [id]: { ...rec, fotos } } }
        })
      },
    }),
    {
      name: 'att-store-v3',
      partialize: (s) => ({
        records: Object.fromEntries(
          Object.entries(s.records).map(([id, rec]) => [id, {
            ...rec,
            fotoAerea: rec.fotoAerea ? { ...rec.fotoAerea, previewUrl: '' } : undefined,
            fotos: rec.fotos.map((f) => ({ ...f, previewUrl: '' })),
          }])
        ),
      }),
    }
  )
)
