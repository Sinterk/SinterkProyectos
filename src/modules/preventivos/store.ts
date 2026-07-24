import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from '@/core/utils/nanoid'
import { useAuth } from '@/lib/auth'
import { preventivoRepo, isUuid } from './data/preventivoRepo'
import { uploadRecordPhotos } from './data/photoStorage'
import type { Preventivo, CuadranteInfo, Punto, FotoKey, FotoEntry } from './types'

export type RemoveResult =
  | { ok: true; mode: 'deleted' | 'closed' }
  | { ok: false; error: string }

/**
 * ¿Le falta a este record algo por sincronizar? Igual criterio que en ATT:
 * nunca llegó al servidor (id sigue siendo el nanoid de creación local), o
 * ya existe allá pero le quedó una foto capturada localmente sin subir a
 * Storage (plano o alguna de las 3 por punto).
 */
export function hasPendingSync(record: Preventivo): boolean {
  if (!isUuid(record.id)) return true
  const pendingFoto = (f?: FotoEntry) => !!f?.blobId && !f.storagePath
  if (pendingFoto(record.cuadrante.fotoPlano)) return true
  return record.puntos.some((p) => pendingFoto(p.fotoLevantamiento) || pendingFoto(p.fotoAntes) || pendingFoto(p.fotoDespues))
}

/** Todas las fotos (plano + puntos) de un record, indexadas por storagePath. */
function collectFotosByPath(record: Preventivo | undefined): Map<string, FotoEntry> {
  const map = new Map<string, FotoEntry>()
  if (!record) return map
  if (record.cuadrante.fotoPlano?.storagePath) map.set(record.cuadrante.fotoPlano.storagePath, record.cuadrante.fotoPlano)
  for (const p of record.puntos) {
    for (const f of [p.fotoLevantamiento, p.fotoAntes, p.fotoDespues]) {
      if (f?.storagePath) map.set(f.storagePath, f)
    }
  }
  return map
}

/**
 * Fusiona un record recién leído del servidor con lo que ya hay en cache:
 * - si lo local es más nuevo (edición en curso aún no sincronizada), se
 *   conserva lo local tal cual (evita pisar tipeo en curso con datos viejos).
 * - si el servidor gana, se preservan los `previewUrl`/`blobId` locales de
 *   las fotos ya resueltas (por storagePath), para no forzar un refetch de
 *   la signed URL sin necesidad.
 */
function mergeFromServer(local: Preventivo | undefined, server: Preventivo): Preventivo {
  if (local && local.updatedAt > server.updatedAt) return local

  const localFotos = collectFotosByPath(local)
  function mergeFoto(f: FotoEntry | undefined): FotoEntry | undefined {
    if (!f?.storagePath) return f
    const prev = localFotos.get(f.storagePath)
    return prev ? { ...f, previewUrl: prev.previewUrl, blobId: prev.blobId } : f
  }

  return {
    ...server,
    cuadrante: { ...server.cuadrante, fotoPlano: mergeFoto(server.cuadrante.fotoPlano) },
    puntos: server.puntos.map((p) => ({
      ...p,
      fotoLevantamiento: mergeFoto(p.fotoLevantamiento),
      fotoAntes: mergeFoto(p.fotoAntes),
      fotoDespues: mergeFoto(p.fotoDespues),
    })),
  }
}

interface PreventivoState {
  records: Record<string, Preventivo>
  /** Ver `syncedAt` en att/store.ts: distingue "el store se refrescó desde
   *  Supabase" de "el usuario editó algo", para que el autoguardado no
   *  dispare un guardado espurio al abrir/recargar un levantamiento. */
  syncedAt: Record<string, number>

  upsert: (p: Preventivo) => void
  createNew: () => string
  /** Borra (admin) o cierra (jp/invitado) según lo que la RLS permita al rol actual. */
  remove: (id: string) => Promise<RemoveResult>
  /** Widget de estado del Editor (jp/admin): abrir/cerrar directo, sin pasar por `remove`. */
  setEstado: (id: string, estado: 'activo' | 'cerrado') => Promise<{ ok: true } | { ok: false; error: string }>
  updateCuadrante: (id: string, data: Partial<CuadranteInfo>) => void
  addPunto: (id: string) => string
  removePunto: (id: string, puntoId: string) => void
  updatePunto: (id: string, puntoId: string, data: Partial<Omit<Punto, 'id'>>) => void
  movePunto: (id: string, from: number, to: number) => void
  setFoto: (id: string, puntoId: string, key: FotoKey, entry: FotoEntry) => void
  removeFoto: (id: string, puntoId: string, key: FotoKey) => void

  /** Trae la lista del servidor y la fusiona en cache. */
  syncList: () => Promise<void>
  /** Trae un levantamiento puntual del servidor (deep-link / recarga en el Editor). */
  syncOne: (id: string) => Promise<void>
  /** Tras el primer guardado de un borrador local, reemplaza su id nanoid por el uuid del servidor. */
  rekey: (oldId: string, saved: Preventivo) => void
  /** Sube fotos pendientes y persiste en Supabase (autoguardado + migración). */
  persistToServer: (id: string) => Promise<Preventivo>

  setFotoPlanoStoragePath: (id: string, storagePath: string) => void
  setPuntoFotoStoragePath: (id: string, puntoId: string, key: FotoKey, storagePath: string) => void
  /** No marcan `touch()` a propósito: restaurar un preview (desde IDB o signed
   *  URL) no es una edición del usuario, y no debe disparar el autoguardado. */
  setFotoPlanoPreview: (id: string, previewUrl: string) => void
  setPuntoFotoPreview: (id: string, puntoId: string, key: FotoKey, previewUrl: string) => void
}

const emptyC = (): CuadranteInfo => ({
  cuadrante: '', comuna: '', grupo: '', fecha: '', semana: '', semestre: '',
  nombreCuadrante: '', direccion: '', zona: '', responsable: '',
})

export function emptyPreventivo(id: string, now: number): Preventivo {
  return { id, cuadrante: emptyC(), puntos: [], createdAt: now, updatedAt: now, estado: 'activo' }
}

function touch(rec: Preventivo, extra?: Partial<Preventivo>): Preventivo {
  return { ...rec, ...extra, updatedAt: Date.now() }
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const usePreventivoStore = create<PreventivoState>()(
  persist(
    (set, get) => ({
      records: {},
      syncedAt: {},

      upsert: (p) => set((s) => ({ records: { ...s.records, [p.id]: p } })),

      createNew: () => {
        const id = nanoid()
        const now = Date.now()
        set((s) => ({ records: { ...s.records, [id]: emptyPreventivo(id, now) } }))
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
            await preventivoRepo.remove(id)
            dropLocal()
            return { ok: true, mode: 'deleted' }
          } else {
            await preventivoRepo.close(id)
            dropLocal()
            return { ok: true, mode: 'closed' }
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },

      async setEstado(id, estado) {
        if (!isUuid(id)) return { ok: false, error: 'Guarda el levantamiento primero.' }
        try {
          if (estado === 'cerrado') await preventivoRepo.close(id)
          else await preventivoRepo.reopen(id)
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
        const serverRecords = await preventivoRepo.list()
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
        const rec = await preventivoRepo.load(id)
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
          const oldFotos = collectFotosByPath(old)
          function restore(f: FotoEntry | undefined): FotoEntry | undefined {
            if (!f?.storagePath) return f
            const prev = oldFotos.get(f.storagePath)
            return prev ? { ...f, previewUrl: prev.previewUrl, blobId: prev.blobId } : f
          }
          const merged: Preventivo = {
            ...saved,
            cuadrante: { ...saved.cuadrante, fotoPlano: restore(saved.cuadrante.fotoPlano) },
            puntos: saved.puntos.map((p) => ({
              ...p,
              fotoLevantamiento: restore(p.fotoLevantamiento),
              fotoAntes: restore(p.fotoAntes),
              fotoDespues: restore(p.fotoDespues),
            })),
          }
          next[saved.id] = merged
          return { records: next, syncedAt: { ...s.syncedAt, [saved.id]: saved.updatedAt } }
        })
      },

      async persistToServer(id) {
        const current = get().records[id]
        if (!current) throw new Error('persistToServer: el levantamiento ya no está en el store local')

        const withPhotos = await uploadRecordPhotos(current)
        if (
          withPhotos.cuadrante.fotoPlano?.storagePath
          && withPhotos.cuadrante.fotoPlano.storagePath !== current.cuadrante.fotoPlano?.storagePath
        ) {
          get().setFotoPlanoStoragePath(id, withPhotos.cuadrante.fotoPlano.storagePath)
        }
        const KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']
        withPhotos.puntos.forEach((p, i) => {
          const cur = current.puntos[i]
          for (const key of KEYS) {
            const f = p[key]
            if (f?.storagePath && f.storagePath !== cur?.[key]?.storagePath) {
              get().setPuntoFotoStoragePath(id, p.id, key, f.storagePath)
            }
          }
        })

        const saved = await preventivoRepo.save(withPhotos)
        if (saved.id !== id) get().rekey(id, saved)
        return saved
      },

      setFotoPlanoStoragePath(id, storagePath) {
        set((s) => {
          const rec = s.records[id]
          if (!rec?.cuadrante.fotoPlano) return s
          return {
            records: {
              ...s.records,
              [id]: { ...rec, cuadrante: { ...rec.cuadrante, fotoPlano: { ...rec.cuadrante.fotoPlano, storagePath } } },
            },
          }
        })
      },

      setPuntoFotoStoragePath(id, puntoId, key, storagePath) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const puntos = rec.puntos.map((p) => {
            if (p.id !== puntoId) return p
            const foto = p[key]
            return foto ? { ...p, [key]: { ...foto, storagePath } } : p
          })
          return { records: { ...s.records, [id]: { ...rec, puntos } } }
        })
      },

      setFotoPlanoPreview(id, previewUrl) {
        set((s) => {
          const rec = s.records[id]
          if (!rec?.cuadrante.fotoPlano) return s
          return {
            records: {
              ...s.records,
              [id]: { ...rec, cuadrante: { ...rec.cuadrante, fotoPlano: { ...rec.cuadrante.fotoPlano, previewUrl } } },
            },
          }
        })
      },

      setPuntoFotoPreview(id, puntoId, key, previewUrl) {
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          const puntos = rec.puntos.map((p) => {
            if (p.id !== puntoId) return p
            const foto = p[key]
            return foto ? { ...p, [key]: { ...foto, previewUrl } } : p
          })
          return { records: { ...s.records, [id]: { ...rec, puntos } } }
        })
      },

      updateCuadrante: (id, data) => set((s) => {
        const rec = s.records[id]
        if (!rec) return s
        return { records: { ...s.records, [id]: touch(rec, { cuadrante: { ...rec.cuadrante, ...data } }) } }
      }),

      addPunto: (id) => {
        // uuid real (no nanoid): puntos.id es uuid en la BD y debe sobrevivir
        // a replacePuntos (upsert por id) — ver preventivoRepo.ts.
        const puntoId = crypto.randomUUID()
        set((s) => {
          const rec = s.records[id]
          if (!rec) return s
          return {
            records: {
              ...s.records,
              [id]: touch(rec, {
                puntos: [...rec.puntos, { id: puntoId, nombre: '', descripcion: '', direccion: '', correccion: '', hallazgo: '', resuelto: false }],
              }),
            },
          }
        })
        return puntoId
      },

      removePunto: (id, puntoId) => set((s) => {
        const rec = s.records[id]
        if (!rec) return s
        return { records: { ...s.records, [id]: touch(rec, { puntos: rec.puntos.filter((p) => p.id !== puntoId) }) } }
      }),

      movePunto: (id, from, to) => set((s) => {
        const rec = s.records[id]
        if (!rec) return s
        const puntos = [...rec.puntos]
        const [removed] = puntos.splice(from, 1)
        puntos.splice(to, 0, removed)
        return { records: { ...s.records, [id]: touch(rec, { puntos }) } }
      }),

      updatePunto: (id, puntoId, data) => set((s) => {
        const rec = s.records[id]
        if (!rec) return s
        return {
          records: {
            ...s.records,
            [id]: touch(rec, { puntos: rec.puntos.map((p) => (p.id === puntoId ? { ...p, ...data } : p)) }),
          },
        }
      }),

      setFoto: (id, puntoId, key, entry) => set((s) => {
        const rec = s.records[id]
        if (!rec) return s
        return {
          records: {
            ...s.records,
            [id]: touch(rec, { puntos: rec.puntos.map((p) => (p.id === puntoId ? { ...p, [key]: entry } : p)) }),
          },
        }
      }),

      removeFoto: (id, puntoId, key) => set((s) => {
        const rec = s.records[id]
        if (!rec) return s
        return {
          records: {
            ...s.records,
            [id]: touch(rec, {
              puntos: rec.puntos.map((p) => {
                if (p.id !== puntoId) return p
                const next = { ...p }
                delete next[key]
                return next
              }),
            }),
          },
        }
      }),
    }),
    {
      name: 'preventivos-store-v2',
      partialize: (s) => ({
        records: Object.fromEntries(
          Object.entries(s.records).map(([k, v]) => [
            k,
            {
              ...v,
              cuadrante: {
                ...v.cuadrante,
                fotoPlano: v.cuadrante.fotoPlano
                  ? { ...v.cuadrante.fotoPlano, previewUrl: '' }
                  : undefined,
              },
              puntos: v.puntos.map((p) => ({
                ...p,
                fotoLevantamiento: p.fotoLevantamiento ? { ...p.fotoLevantamiento, previewUrl: '' } : undefined,
                fotoAntes: p.fotoAntes ? { ...p.fotoAntes, previewUrl: '' } : undefined,
                fotoDespues: p.fotoDespues ? { ...p.fotoDespues, previewUrl: '' } : undefined,
              })),
            },
          ]),
        ),
      }),
    },
  ),
)
