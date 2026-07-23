import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from '@/core/utils/nanoid'
import { useAuth } from '@/lib/auth'
import { incidenciaRepo, isUuid } from './data/incidenciaRepo'
import { uploadRecordPhotos } from './data/photoStorage'
import type { Incidencia, FotoEntry } from './types'

export type RemoveResult =
  | { ok: true; mode: 'deleted' | 'closed' }
  | { ok: false; error: string }

/** ¿Le falta a esta incidencia algo por sincronizar? (nunca llegó al servidor, o le quedó una foto local sin subir). */
export function hasPendingSync(record: Incidencia): boolean {
  if (!isUuid(record.id)) return true
  return record.fotos.some((f) => !!f.blobId && !f.storagePath)
}

/**
 * Fusiona un record recién leído del servidor con lo que ya hay en cache —
 * mismo criterio que att/store.ts: si lo local es más nuevo, se conserva tal
 * cual; si gana el servidor, se preservan previewUrl/blobId locales de las
 * fotos ya resueltas (por storagePath).
 */
function mergeFromServer(local: Incidencia | undefined, server: Incidencia): Incidencia {
  if (local && local.updatedAt > server.updatedAt) return local
  function mergeFoto(f: FotoEntry): FotoEntry {
    const prev = local?.fotos.find((lf) => lf.storagePath && lf.storagePath === f.storagePath)
    return prev ? { ...f, previewUrl: prev.previewUrl, blobId: prev.blobId } : f
  }
  return { ...server, fotos: server.fotos.map(mergeFoto) }
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyIncidencia(id: string, now: number): Incidencia {
  return {
    id, createdAt: now, updatedAt: now,
    estado: 'activo',
    codigo: '', ingeniero: '', direccion: '',
    fotos: [],
  }
}

interface IncidenciaState {
  records: Record<string, Incidencia>
  syncedAt: Record<string, number>

  createNew: () => string
  remove: (id: string) => Promise<RemoveResult>
  setEstado: (id: string, estado: 'activo' | 'cerrado') => Promise<{ ok: true } | { ok: false; error: string }>
  update: (id: string, data: Partial<Pick<Incidencia, 'codigo' | 'ingeniero' | 'direccion'>>) => void

  syncList: () => Promise<void>
  syncOne: (id: string) => Promise<void>
  rekey: (oldId: string, saved: Incidencia) => void
  persistToServer: (id: string) => Promise<Incidencia>

  setFotoStoragePath: (id: string, index: number, storagePath: string) => void
  addFoto: (id: string, entry: FotoEntry) => void
  removeFoto: (id: string, index: number) => void
  setFotoPreview: (id: string, index: number, previewUrl: string) => void
}

function touch(rec: Incidencia, extra?: Partial<Incidencia>): Incidencia {
  return { ...rec, ...extra, updatedAt: Date.now() }
}

export const useIncidenciaStore = create<IncidenciaState>()(
  persist(
    (set, get) => ({
      records: {},
      syncedAt: {},

      createNew() {
        const id = nanoid()
        const now = Date.now()
        set((s) => ({ records: { ...s.records, [id]: emptyIncidencia(id, now) } }))
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
        if (!isUuid(id)) {
          dropLocal()
          return { ok: true, mode: 'deleted' }
        }
        const isAdmin = useAuth.getState().profile?.rol === 'admin'
        try {
          if (isAdmin) {
            await incidenciaRepo.remove(id)
            dropLocal()
            return { ok: true, mode: 'deleted' }
          } else {
            await incidenciaRepo.close(id)
            dropLocal()
            return { ok: true, mode: 'closed' }
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },

      async setEstado(id, estado) {
        if (!isUuid(id)) return { ok: false, error: 'Guarda la incidencia primero.' }
        try {
          if (estado === 'cerrado') await incidenciaRepo.close(id)
          else await incidenciaRepo.reopen(id)
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
        const serverRecords = await incidenciaRepo.list()
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
        const rec = await incidenciaRepo.load(id)
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
          const fotos = saved.fotos.map((f, i) => {
            const prev = old?.fotos[i]
            return prev ? { ...f, previewUrl: prev.previewUrl, blobId: prev.blobId } : f
          })
          next[saved.id] = { ...saved, fotos }
          return { records: next, syncedAt: { ...s.syncedAt, [saved.id]: saved.updatedAt } }
        })
      },

      async persistToServer(id) {
        const current = get().records[id]
        if (!current) throw new Error('persistToServer: la incidencia ya no está en el store local')

        const withPhotos = await uploadRecordPhotos(current)
        withPhotos.fotos.forEach((f, i) => {
          if (f.storagePath && f.storagePath !== current.fotos[i]?.storagePath) {
            get().setFotoStoragePath(id, i, f.storagePath)
          }
        })

        const saved = await incidenciaRepo.save(withPhotos)
        if (saved.id !== id) get().rekey(id, saved)
        return saved
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
      name: 'incidencias-store-v1',
      partialize: (s) => ({
        records: Object.fromEntries(
          Object.entries(s.records).map(([id, rec]) => [id, {
            ...rec,
            fotos: rec.fotos.map((f) => ({ ...f, previewUrl: '' })),
          }])
        ),
      }),
    }
  )
)
