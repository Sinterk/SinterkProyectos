import { useRef, useState } from 'react'
import JSZip from 'jszip'
import { usePreventivoStore } from '../store'
import { savePhotoBlob } from '@/core/offline/photoStore'
import { nanoid } from '@/core/utils/nanoid'
import type { Preventivo, FotoEntry } from '../types'

interface Props { onImported: (id: string) => void }

export function ImportZip({ onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'idle'|'loading'|'error'>('idle')
  const [msg, setMsg] = useState('')
  const { upsert } = usePreventivoStore()

  // ── Procesar el archivo ZIP (lógica compartida) ───────────────────────────
  async function processFile(file: File) {
    setState('loading'); setMsg('')
    try {
      const zip = await JSZip.loadAsync(file)
      const mf = zip.file('telecom_v1.json'); if (!mf) throw new Error('ZIP inválido: falta telecom_v1.json')
      const meta = JSON.parse(await mf.async('string'))
      if (meta.version !== 1) throw new Error('Versión no compatible')
      const lev = meta.levantamiento
      async function loadFoto(fm: {fileName:string;capturedAt:string}|null|undefined): Promise<FotoEntry|undefined> {
        if (!fm?.fileName) return undefined
        const zf = zip.file(`fotos/${fm.fileName}`); if (!zf) return undefined
        const blob = await zf.async('blob'); const blobId = nanoid()
        await savePhotoBlob({ id:blobId, blob, fileName:fm.fileName })
        return { previewUrl:URL.createObjectURL(blob), fileName:fm.fileName, blobId, capturedAt:fm.capturedAt||new Date().toISOString(), annotated:false }
      }
      const now = Date.now()
      const p: Preventivo = {
        id: lev.id||nanoid(), createdAt:lev.createdAt||now, updatedAt:now, estado: 'activo',
        cuadrante: { cuadrante:lev.cuadrante.cuadrante||'', comuna:lev.cuadrante.comuna||'', grupo:lev.cuadrante.grupo||'', fecha:lev.cuadrante.fecha||'', semana:lev.cuadrante.semana||'', semestre:lev.cuadrante.semestre||'', nombreCuadrante:lev.cuadrante.nombreCuadrante||'', direccion:lev.cuadrante.direccion||'', zona:lev.cuadrante.zona||'', responsable:lev.cuadrante.responsable||'', fotoPlano:await loadFoto(lev.cuadrante.fotoPlano) },
        puntos: await Promise.all((lev.puntos||[]).map(async (pt: any) => ({ id:pt.id||nanoid(), nombre:pt.nombre||'', descripcion:pt.descripcion||'', direccion:pt.direccion||'', correccion:pt.correccion||'', hallazgo:pt.hallazgo||'', resuelto:!!pt.resuelto, fotoLevantamiento:await loadFoto(pt.fotos?.levantamiento), fotoAntes:await loadFoto(pt.fotos?.antes), fotoDespues:await loadFoto(pt.fotos?.despues) })))
      }
      upsert(p); onImported(p.id)
    } catch(err) {
      setMsg(err instanceof Error ? err.message : 'Error al importar')
      setState('error')
    }
  }

  // ── Input fallback (Android / Safari / Firefox) ───────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    await processFile(file)
    if (e.target) e.target.value = ''
  }

  // ── Click principal: intenta File System Access API → fallback a input ────
  async function handleClick() {
    // showOpenFilePicker (Chrome/Edge 86+) permite abrir directamente en Descargas
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'ZIP de TelecomCatalog', accept: { 'application/zip': ['.zip'] } }],
          startIn: 'downloads',
          multiple: false,
        })
        const file: File = await handle.getFile()
        await processFile(file)
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // usuario canceló
        // Otro error → caer al input normal
      }
    }
    fileRef.current?.click()
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={state==='loading'}
        className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
        {state==='loading' ? '⏳ Importando…' : '📥 Importar ZIP'}
      </button>
      {state==='error' && <p className="text-red-400 text-xs mt-1.5">❌ {msg}</p>}
      <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleFile} />
    </div>
  )
}
