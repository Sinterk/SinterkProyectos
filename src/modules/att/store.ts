import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from '@/core/utils/nanoid'
import { monotonicNow } from '@/core/utils/monotonicNow'
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
 * Fusiona un record recién leído del servidor con lo que ya hay en cache.
 *
 * Antes esto se decidía comparando `local.updatedAt > server.updatedAt` —
 * dos relojes distintos (el del dispositivo vs. el de Postgres). Si el
 * reloj del celular/PC estaba atrasado respecto al del servidor, una
 * edición local recién terminada podía "perder" contra un guardado parcial
 * anterior (ej. autoguardado de una pausa a mitad de tipeo) — bug real
 * reportado por Andrés (texto de OTT cortado a la mitad al cambiar de
 * pestaña). Ahora se decide con `synced`: el `updatedAt` que se sabe con
 * certeza que ya quedó confirmado en el servidor (ver `syncedAt` más abajo
 * y cómo lo actualiza `persistToServer`). Si el `updatedAt` local no
 * coincide con ese valor, hay una edición sin confirmar y se conserva lo
 * local — sin comparar timestamps de relojes distintos.
 *
 * Además, si el servidor gana, se preservan los `previewUrl`/`blobId`
 * locales de las fotos que ya se habían resuelto (por storagePath), para no
 * perder la miniatura y forzar un refetch de la signed URL sin necesidad.
 */
function mergeFromServer(local: AttRecord | undefined, server: AttRecord, synced: number | undefined): AttRecord {
  if (local && local.updatedAt !== synced) return local

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
   * `updatedAt` que se sabe con certeza que ya quedó confirmado en el
   * servidor para cada record (lo actualizan `syncList`/`syncOne`/`rekey` al
   * traer del servidor, y `persistToServer` al guardar con éxito). Dos usos:
   * 1. `useAttAutosave` lo usa para no confundir "el store se refrescó desde
   *    Supabase" con "el usuario tipeó algo" — si no se distinguiera, cada
   *    vez que se abre o recarga un informe se dispararía un guardado
   *    (delete+insert de tramos/fotos) sin que nadie haya editado nada.
   * 2. `mergeFromServer` lo usa para decidir si hay una edición local sin
   *    confirmar (`record.updatedAt !== syncedAt[id]`) — a propósito NO se
   *    compara contra el `updatedAt` que trae el servidor en cada fetch,
   *    porque son relojes distintos (dispositivo vs. Postgres) y comparar
   *    timestamps de relojes distintos es frágil (ver el comentario de
   *    `mergeFromServer`). Por eso este mapa se persiste (`partialize`, más
   *    abajo): si no sobreviviera un reload, toda edición local parecería
   *    "sin confirmar" para siempre y el servidor nunca podría traer
   *    cambios de otro dispositivo/usuario para ese record.
   */
  syncedAt: Record<string, number>

  createNew: () => string
  /** Borra (admin) o cierra (jp/invitado) según lo que la RLS permita al rol actual. */
  remove: (id: string) => Promise<RemoveResult>
  /** Widget de estado del Editor (jp/admin): abrir/cerrar directo, sin pasar por `remove`. */
  setEstado: (id: string, estado: 'activo' | 'cerrado') => Promise<{ ok: true } | { ok: false; error: string }>
  update: (id: string, data: Partial<AttRecord>) => void
  /** Fecha de término escrita a mano en la barra fija del Editor. Va por su
   *  propio camino (no por el autoguardado) porque `fecha_cierre` está
   *  excluido del payload de `save()` a propósito — ver `recordToProjectRow`. */
  setFechaCierre: (id: string, fecha: string) => Promise<{ ok: true } | { ok: false; error: string }>

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
  return { ...rec, ...extra, updatedAt: monotonicNow() }
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
            // Al cerrar NO se pisa una fecha de término que ya estuviera puesta —
            // mismo criterio que `closeProject` en el servidor.
            return { records: { ...s.records, [id]: { ...rec, estado, fechaCierre: estado === 'cerrado' ? (rec.fechaCierre || todayISO()) : undefined } } }
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
            const merged = mergeFromServer(before, rec, s.syncedAt[rec.id])
            records[rec.id] = merged
            if (merged.updatedAt !== before?.updatedAt) syncedAt[rec.id] = merged.updatedAt
          }
          // Saca de la caché lo que el servidor ya no tiene como activo — sin
          // esto, un informe borrado (o cerrado) en el servidor quedaba de
          // fantasma para siempre en este dispositivo: seguía en la lista, y
          // al intentar borrarlo el DELETE no encontraba nada que borrar
          // ("0 filas afectadas"), lo que el mensaje de error atribuía por
          // error a falta de permisos. Bug real encontrado por Andrés con los
          // datos de prueba que el script de limpieza ya había borrado.
          //
          // Guardas para no perder trabajo: nunca un borrador local ni algo
          // con fotos sin subir (`hasPendingSync`), solo lo que localmente
          // figura como activo (un cerrado no tiene por qué venir en esta
          // lista), y nada con ediciones locales sin confirmar. Ojo con esto
          // último: `syncedAt` puede venir `undefined` en caché vieja (es un
          // marcador reciente), y eso NO significa "tiene ediciones" — si no
          // se distinguiera, los fantasmas viejos (justo el caso que hay que
          // limpiar) nunca se irían.
          const idsServidor = new Set(serverRecords.map((r) => r.id))
          for (const rec of Object.values(records)) {
            if (idsServidor.has(rec.id)) continue
            if (rec.estado !== 'activo') continue
            if (hasPendingSync(rec)) continue
            const marcado = syncedAt[rec.id]
            if (marcado !== undefined && rec.updatedAt !== marcado) continue
            delete records[rec.id]
            delete syncedAt[rec.id]
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
          const merged = mergeFromServer(before, rec, s.syncedAt[id])
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
        const startedUpdatedAt = current.updatedAt

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
        if (saved.id !== id) {
          get().rekey(id, saved) // borrador local promovido a uuid del servidor
        } else {
          // Marca este `updatedAt` como confirmado en el servidor — pero solo
          // si nada cambió localmente mientras el guardado viajaba a
          // Supabase (comparación local-contra-local, mismo reloj, sin el
          // problema de `mergeFromServer`). Si sí cambió, se deja "sin
          // confirmar" a propósito: el próximo ciclo de autoguardado va a
          // volver a intentarlo con lo más nuevo.
          set((s) => {
            const nowRec = s.records[id]
            if (nowRec && nowRec.updatedAt === startedUpdatedAt) {
              return { syncedAt: { ...s.syncedAt, [id]: startedUpdatedAt } }
            }
            return s
          })
        }
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

      async setFechaCierre(id, fecha) {
        if (!isUuid(id)) return { ok: false, error: 'Guarda el informe primero.' }
        try {
          await attRepo.setFechaCierre(id, fecha || null)
          set((s) => {
            const rec = s.records[id]
            if (!rec) return s
            return { records: { ...s.records, [id]: { ...rec, fechaCierre: fecha || undefined } } }
          })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
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
        // Tiene que sobrevivir un reload: si no, toda edición local parecería
        // "sin confirmar" para siempre (ver comentario de `syncedAt` arriba).
        syncedAt: s.syncedAt,
      }),
    }
  )
)
