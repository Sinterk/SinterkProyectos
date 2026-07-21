// Visor local de un ZIP ya descargado (export de un proyecto individual —
// ExportZipButton — o del ZIP combinado de "Descargar cerrados"). No sube ni
// consulta nada a Supabase: sirve para revisar fotos/informes de proyectos a
// los que ya se les borraron las fotos de Storage para ahorrar espacio.

import { useState } from 'react'
import JSZip from 'jszip'

interface FotoEntry { name: string; url: string }
interface DocEntry { name: string; url: string }
interface ProjectFolder { name: string; fotos: FotoEntry[]; docs: DocEntry[] }

interface Props { onClose: () => void }

const DOC_EXTENSIONS = ['.docx', '.pdf', '.xlsx', '.json']

function isImage(path: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(path)
}

export function ZipArchiveViewer({ onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [folders, setFolders] = useState<ProjectFolder[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  async function handleFile(file: File) {
    setLoading(true); setError(''); setFolders(null)
    try {
      const zip = await JSZip.loadAsync(file)
      const byFolder = new Map<string, { fotos: FotoEntry[]; docs: DocEntry[] }>()

      const entries = Object.values(zip.files).filter((f) => !f.dir)
      for (const entry of entries) {
        const parts = entry.name.split('/')
        const top = parts[0]
        if (!byFolder.has(top)) byFolder.set(top, { fotos: [], docs: [] })
        const bucket = byFolder.get(top)!
        const blob = await entry.async('blob')
        const url = URL.createObjectURL(blob)
        const fileName = parts[parts.length - 1]
        if (isImage(entry.name)) {
          bucket.fotos.push({ name: fileName, url })
        } else if (DOC_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
          bucket.docs.push({ name: fileName, url })
        }
      }

      const result: ProjectFolder[] = [...byFolder.entries()]
        .filter(([, v]) => v.fotos.length > 0 || v.docs.length > 0)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => a.name.localeCompare(b.name))

      if (result.length === 0) setError('El ZIP no contiene fotos ni informes reconocibles.')
      setFolders(result)
    } catch (err) {
      console.error('[ZipArchiveViewer] error leyendo ZIP:', err)
      setError('No se pudo leer el archivo. ¿Es un ZIP válido?')
    } finally {
      setLoading(false)
    }
  }

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">📂 Abrir proyecto descargado</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
        </div>

        <p className="text-xs text-slate-400">
          Selecciona un ZIP descargado previamente (individual o el combinado de "Descargar
          cerrados") para revisar sus fotos e informes. Esto no sube ni consulta nada en Supabase.
        </p>

        <input type="file" accept=".zip"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f).catch(console.error) }}
          className="block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white file:text-xs file:font-semibold hover:file:bg-brand-700" />

        {loading && <p className="text-xs text-slate-400">⏳ Leyendo ZIP…</p>}
        {error && <p className="text-xs text-red-400">⚠️ {error}</p>}

        {folders && folders.length > 0 && (
          <div className="space-y-2">
            {folders.map((folder) => (
              <div key={folder.name} className="border border-slate-700 rounded-xl overflow-hidden">
                <button type="button" onClick={() => toggle(folder.name)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/60 text-left">
                  <span className="text-sm text-white font-medium truncate">{folder.name}</span>
                  <span className="text-xs text-slate-500 shrink-0 ml-2">
                    📷 {folder.fotos.length} · 📄 {folder.docs.length}
                  </span>
                </button>
                {open.has(folder.name) && (
                  <div className="p-3 space-y-3">
                    {folder.docs.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {folder.docs.map((d) => (
                          <a key={d.name} href={d.url} download={d.name}
                            className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded-lg">
                            📄 {d.name}
                          </a>
                        ))}
                      </div>
                    )}
                    {folder.fotos.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {folder.fotos.map((f) => (
                          <a key={f.name} href={f.url} target="_blank" rel="noreferrer" title={f.name}>
                            <img src={f.url} alt={f.name} className="w-full aspect-square object-cover rounded-lg border border-slate-700" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
