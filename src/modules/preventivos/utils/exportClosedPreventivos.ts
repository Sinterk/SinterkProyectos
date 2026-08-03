// Exportador masivo de levantamientos preventivos cerrados: arma un único ZIP
// con una carpeta por cuadrante (fotos originales + informe Entel + planilla
// de levantamiento + datos.json), trayendo las fotos desde Supabase Storage
// por signed URL (no depende del caché local, a diferencia de
// ExportZipButton, que sí sirve para un solo proyecto ya abierto en este
// dispositivo).

import JSZip from 'jszip'
import { getSignedUrls } from '../data/photoStorage'
import { buildInformeEntelBlob } from './generarInformeEntel'
import { generarLevantamientoBlob } from './generarLevantamiento'
import type { Preventivo, Punto, FotoEntry, FotoKey } from '../types'

const FOTO_KEYS: FotoKey[] = ['fotoLevantamiento', 'fotoAntes', 'fotoDespues']

function slug(s: string | undefined | null): string {
  return (s || 'sin-cuadrante').replace(/[^a-z0-9-]/gi, '_')
}

function hydrateFoto(f: FotoEntry | undefined, urls: Map<string, string>): FotoEntry | undefined {
  if (!f?.storagePath) return f
  const url = urls.get(f.storagePath)
  return url ? { ...f, previewUrl: url } : f
}

async function hydrateRecord(record: Preventivo): Promise<Preventivo> {
  const paths = [
    record.cuadrante.fotoPlano?.storagePath,
    ...record.puntos.flatMap((p) => FOTO_KEYS.map((k) => p[k]?.storagePath)),
  ].filter((p): p is string => !!p)

  const urls = await getSignedUrls(paths)

  const puntos: Punto[] = record.puntos.map((p) => ({
    ...p,
    fotoLevantamiento: hydrateFoto(p.fotoLevantamiento, urls),
    fotoAntes: hydrateFoto(p.fotoAntes, urls),
    fotoDespues: hydrateFoto(p.fotoDespues, urls),
  }))

  return {
    ...record,
    cuadrante: { ...record.cuadrante, fotoPlano: hydrateFoto(record.cuadrante.fotoPlano, urls) },
    puntos,
  }
}

async function fetchFoto(folder: JSZip, f: FotoEntry | undefined): Promise<void> {
  if (!f?.previewUrl) return
  try {
    const res = await fetch(f.previewUrl)
    if (!res.ok) return
    const blob = await res.blob()
    const name = f.fileName || f.storagePath?.split('/').pop() || `foto_${Date.now()}.jpg`
    folder.file(name, blob)
  } catch (err) {
    console.warn('[exportClosedPreventivos] no se pudo descargar foto:', f.storagePath, err)
  }
}

async function addFotosToZip(folder: JSZip, record: Preventivo): Promise<void> {
  await fetchFoto(folder, record.cuadrante.fotoPlano)
  for (const p of record.puntos) {
    for (const k of FOTO_KEYS) await fetchFoto(folder, p[k])
  }
}

/**
 * Arma un ZIP combinado con todos los `records` (ya filtrados por rango de
 * fechas por el llamador), una carpeta por cuadrante. `onProgress(i, total)`
 * se llama antes de procesar cada proyecto.
 */
export async function buildClosedPreventivosZip(
  records: Preventivo[],
  onProgress?: (i: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip()

  for (let i = 0; i < records.length; i++) {
    onProgress?.(i, records.length)
    const record = records[i]
    const hydrated = await hydrateRecord(record)
    const folderName = `${slug(hydrated.cuadrante.cuadrante)}_${hydrated.id.slice(0, 8)}`
    const folder = zip.folder(folderName)!

    await addFotosToZip(folder.folder('fotos')!, hydrated)

    try {
      const { blob } = await buildInformeEntelBlob(hydrated)
      folder.file('informe_entel.xlsx', blob)
    } catch (err) {
      console.error('[exportClosedPreventivos] error generando informe Entel:', hydrated.id, err)
    }

    try {
      const { blob } = generarLevantamientoBlob(hydrated)
      folder.file('levantamiento.xlsx', blob)
    } catch (err) {
      console.error('[exportClosedPreventivos] error generando levantamiento:', hydrated.id, err)
    }

    folder.file('datos.json', JSON.stringify({
      version: 1, app: 'SinterkProyectos', exportedAt: new Date().toISOString(),
      levantamiento: {
        id: hydrated.id, createdAt: hydrated.createdAt, fechaCierre: hydrated.fechaCierre,
        cuadrante: { ...hydrated.cuadrante, fotoPlano: undefined },
        puntos: hydrated.puntos.map((p) => ({
          id: p.id, nombre: p.nombre, descripcion: p.descripcion,
          direccion: p.direccion, correccion: p.correccion,
          hallazgo: p.hallazgo, resuelto: p.resuelto,
        })),
      },
    }, null, 2))
  }

  onProgress?.(records.length, records.length)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
