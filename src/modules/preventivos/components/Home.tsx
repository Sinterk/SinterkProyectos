import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePreventivoStore } from '../store'
import { ImportZip } from './ImportZip'
import type { Preventivo } from '../types'

function matchesSearch(r: Preventivo, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const { comuna, cuadrante, nombreCuadrante } = r.cuadrante
  return (comuna ?? '').toLowerCase().includes(q)
    || (cuadrante ?? '').toLowerCase().includes(q)
    || (nombreCuadrante ?? '').toLowerCase().includes(q)
}

export function Home() {
  const navigate = useNavigate()
  const { records, createNew, remove } = usePreventivoStore()
  const [search, setSearch] = useState('')
  const list = Object.values(records)
    .filter((r) => matchesSearch(r, search))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  function handleNew() {
    const id = createNew()
    navigate(`/preventivos/${id}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">📡 Levantamientos</h1>
          <p className="text-xs text-slate-400">{list.length} levantamiento(s)</p>
        </div>
        <button type="button" onClick={handleNew}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3 py-2 rounded-xl">
          ➕ Nuevo
        </button>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por comuna, cuadrante o nombre…"
        className="w-full bg-slate-800 text-white text-sm rounded-xl px-3 py-2 border border-slate-700 placeholder-slate-500 focus:border-brand-500 focus:outline-none" />

      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-2">
        <p className="text-sm font-medium text-white">Importar ZIP existente</p>
        <ImportZip onImported={(id) => navigate(`/preventivos/${id}`)} />
        <p className="text-[10px] text-amber-400/80">
          ⚠ En WhatsApp: enviar como <strong>Documento</strong> (clip 📎), no como imagen
        </p>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-16 text-slate-500 space-y-2">
          <div className="text-5xl">🔌</div>
          <p className="text-sm">{search ? 'Sin resultados.' : 'Crea tu primer levantamiento o importa un ZIP.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <CuadranteCard key={r.id} record={r}
              onSelect={() => navigate(`/preventivos/${r.id}`)}
              onDelete={() => { if (confirm('¿Eliminar este levantamiento?')) remove(r.id) }} />
          ))}
        </div>
      )}
    </div>
  )
}

function CuadranteCard({ record, onSelect, onDelete }: {
  record: Preventivo; onSelect: () => void; onDelete: () => void
}) {
  const fotos = record.puntos.reduce(
    (n, p) => n + (p.fotoLevantamiento ? 1 : 0) + (p.fotoAntes ? 1 : 0) + (p.fotoDespues ? 1 : 0), 0)
  const conFoto = record.puntos.filter((p) => p.fotoLevantamiento || p.fotoAntes || p.fotoDespues).length
  const total = record.puntos.length

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 hover:border-brand-500 transition-colors">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onSelect} className="flex-1 text-left min-w-0">
          <div className="text-sm text-white">
            {record.cuadrante.comuna
              ? <><span className="font-bold">{record.cuadrante.comuna}</span><span className="text-slate-400"> — {record.cuadrante.cuadrante || 'Sin ID'}</span></>
              : <span className="font-bold">{record.cuadrante.cuadrante || 'Sin ID'}</span>}
          </div>
          {record.cuadrante.nombreCuadrante && (
            <div className="text-xs text-slate-400 mt-0.5 truncate">{record.cuadrante.nombreCuadrante}</div>
          )}
          <div className="flex gap-3 mt-1.5 flex-wrap">
            <span className="text-[11px] text-slate-500">{total} punto(s)</span>
            <span className="text-[11px] text-slate-500">📷 {fotos}</span>
            {total > 0 && (
              <span className={`text-[11px] font-medium ${conFoto === total ? 'text-green-400' : 'text-amber-400'}`}>
                {conFoto}/{total} con foto
              </span>
            )}
            {record.cuadrante.fecha && <span className="text-[11px] text-slate-500">📅 {record.cuadrante.fecha}</span>}
          </div>
          {total > 0 && (
            <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(conFoto / total) * 100}%` }} />
            </div>
          )}
        </button>
        <button type="button" onClick={onDelete}
          className="text-slate-600 hover:text-red-400 text-lg p-1 leading-none shrink-0">×</button>
      </div>
    </div>
  )
}
