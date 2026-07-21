// Exportador masivo de informes ATT cerrados: arma un único ZIP con una
// carpeta por proyecto (fotos originales + informe Word + informe PDF +
// datos.json), trayendo las fotos desde Supabase Storage por signed URL en
// vez de depender del caché local (IndexedDB) — a diferencia de
// ExportZipButton (Preventivos), esto debe funcionar aunque el proyecto
// nunca se haya abierto en este dispositivo.
//
// TODO: a futuro, sumar aquí el excel de "estado de pago" cuando exista.

import JSZip from 'jszip'
import { getSignedUrls } from '../data/photoStorage'
import { generarInformeAtt } from './generarInformeAtt'
import { generarPdfAttBlob } from './generarPdfAtt'
import type { AttRecord, FotoEntry } from '../types'

function slug(s: string | undefined | null): string {
  return (s || 'sin-ott').replace(/[^a-z0-9-]/gi, '_')
}

/** Reemplaza `previewUrl` por la signed URL correspondiente a `storagePath`. */
function hydrateFoto(f: FotoEntry | undefined, urls: Map<string, string>): FotoEntry | undefined {
  if (!f?.storagePath) return f
  const url = urls.get(f.storagePath)
  return url ? { ...f, previewUrl: url } : f
}

async function hydrateRecord(record: AttRecord): Promise<AttRecord> {
  const paths = [
    record.fotoAerea?.storagePath,
    ...record.fotos.map((f) => f.storagePath),
  ].filter((p): p is string => !!p)

  const urls = await getSignedUrls(paths)

  return {
    ...record,
    fotoAerea: hydrateFoto(record.fotoAerea, urls),
    fotos: record.fotos.map((f) => hydrateFoto(f, urls)!),
  }
}

async function addFotosToZip(folder: JSZip, record: AttRecord): Promise<void> {
  const entries: FotoEntry[] = [
    ...(record.fotoAerea ? [record.fotoAerea] : []),
    ...record.fotos,
  ]
  for (const f of entries) {
    if (!f.previewUrl) continue
    try {
      const res = await fetch(f.previewUrl)
      if (!res.ok) continue
      const blob = await res.blob()
      const name = f.fileName || f.storagePath?.split('/').pop() || `foto_${Date.now()}.jpg`
      folder.file(name, blob)
    } catch (err) {
      console.warn('[exportClosedAtt] no se pudo descargar foto:', f.storagePath, err)
    }
  }
}

/**
 * Arma un ZIP combinado con todos los `records` (ya filtrados por rango de
 * fechas por el llamador), una carpeta por proyecto. `onProgress(i, total)`
 * se llama antes de procesar cada proyecto.
 */
export async function buildClosedAttZip(
  records: AttRecord[],
  onProgress?: (i: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip()

  for (let i = 0; i < records.length; i++) {
    onProgress?.(i, records.length)
    const record = records[i]
    const hydrated = await hydrateRecord(record)
    const folderName = `OTT_${slug(hydrated.ott)}_${hydrated.id.slice(0, 8)}`
    const folder = zip.folder(folderName)!

    await addFotosToZip(folder.folder('fotos')!, hydrated)

    try {
      const docxBlob = await generarInformeAtt(hydrated)
      folder.file('informe_att.docx', docxBlob)
    } catch (err) {
      console.error('[exportClosedAtt] error generando docx:', hydrated.id, err)
    }

    try {
      const { blob: pdfBlob } = await generarPdfAttBlob(hydrated)
      folder.file('informe_att.pdf', pdfBlob)
    } catch (err) {
      console.error('[exportClosedAtt] error generando pdf:', hydrated.id, err)
    }

    folder.file('datos.json', JSON.stringify({
      version: 1, app: 'TelecomCatalog', exportedAt: new Date().toISOString(),
      informe: {
        id: hydrated.id, ott: hydrated.ott, nombreProyecto: hydrated.nombreProyecto,
        tipoProyecto: hydrated.tipoProyecto, comuna: hydrated.comuna, region: hydrated.region,
        contratista: hydrated.contratista, fecha: hydrated.fecha, fechaCierre: hydrated.fechaCierre,
        tramos: hydrated.tramos, hitos: hydrated.hitos,
      },
    }, null, 2))
  }

  onProgress?.(records.length, records.length)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
