// Exportador masivo de incidencias cerradas: arma un único ZIP con una
// carpeta por incidencia (fotos + datos.json), trayendo las fotos desde
// Supabase Storage por signed URL — igual que exportClosedAtt/Preventivos
// (PASO 21), sin generador de informe porque Incidencias no genera informes.

import JSZip from 'jszip'
import { getSignedUrls } from '../data/photoStorage'
import type { Incidencia, FotoEntry } from '../types'

function slug(s: string | undefined | null): string {
  return (s || 'sin-codigo').replace(/[^a-z0-9-]/gi, '_')
}

function hydrateFoto(f: FotoEntry, urls: Map<string, string>): FotoEntry {
  if (!f.storagePath) return f
  const url = urls.get(f.storagePath)
  return url ? { ...f, previewUrl: url } : f
}

async function hydrateRecord(record: Incidencia): Promise<Incidencia> {
  const paths = record.fotos.map((f) => f.storagePath).filter((p): p is string => !!p)
  const urls = await getSignedUrls(paths)
  return { ...record, fotos: record.fotos.map((f) => hydrateFoto(f, urls)) }
}

async function addFotosToZip(folder: JSZip, record: Incidencia): Promise<void> {
  for (const f of record.fotos) {
    if (!f.previewUrl) continue
    try {
      const res = await fetch(f.previewUrl)
      if (!res.ok) continue
      const blob = await res.blob()
      const name = f.fileName || f.storagePath?.split('/').pop() || `foto_${Date.now()}.jpg`
      folder.file(name, blob)
    } catch (err) {
      console.warn('[exportClosedIncidencias] no se pudo descargar foto:', f.storagePath, err)
    }
  }
}

/**
 * Arma un ZIP combinado con todas las `records` (ya filtradas por rango de
 * fechas por el llamador), una carpeta por incidencia. `onProgress(i, total)`
 * se llama antes de procesar cada una.
 */
export async function buildClosedIncidenciasZip(
  records: Incidencia[],
  onProgress?: (i: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip()

  for (let i = 0; i < records.length; i++) {
    onProgress?.(i, records.length)
    const record = records[i]
    const hydrated = await hydrateRecord(record)
    const folderName = `INC_${slug(hydrated.codigo)}_${hydrated.id.slice(0, 8)}`
    const folder = zip.folder(folderName)!

    await addFotosToZip(folder.folder('fotos')!, hydrated)

    folder.file('datos.json', JSON.stringify({
      version: 1, app: 'TelecomCatalog', exportedAt: new Date().toISOString(),
      incidencia: {
        id: hydrated.id, codigo: hydrated.codigo, ingeniero: hydrated.ingeniero,
        direccion: hydrated.direccion, fechaCierre: hydrated.fechaCierre,
      },
    }, null, 2))
  }

  onProgress?.(records.length, records.length)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
