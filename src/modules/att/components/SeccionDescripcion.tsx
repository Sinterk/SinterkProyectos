import { useRef, useState } from 'react'
import { useAttStore } from '../store'
import type { FotoEntry } from '../types'

interface Props {
  recordId: string
  processFotoAerea: (file: File) => Promise<void>
}

const inputCls = 'w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:border-brand-500 focus:outline-none placeholder-slate-500'
const checkCls = 'w-4 h-4 rounded accent-brand-500 cursor-pointer'

export function SeccionDescripcion({ recordId, processFotoAerea }: Props) {
  const { records, update, addTramo, removeTramo, updateTramo, addHito, removeHito, updateHito, removeFotoAerea } = useAttStore()
  const record = records[recordId]
  const aereoInputRef = useRef<HTMLInputElement>(null)
  const [loadingAereo, setLoadingAereo] = useState(false)

  if (!record) return null

  async function handleAereoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoadingAereo(true)
    try { await processFotoAerea(file) } finally {
      setLoadingAereo(false)
      if (aereoInputRef.current) aereoInputRef.current.value = ''
    }
  }

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-5">
      <h2 className="text-xs font-semibold text-brand-400 uppercase tracking-wide">3. Descripción general</h2>

      {/* Tramos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-300">Tramos de cable</p>
          <button type="button" onClick={() => addTramo(recordId)}
            className="text-xs text-brand-400 hover:text-brand-300 font-medium">+ Agregar tramo</button>
        </div>
        {record.tramos.map((tramo, idx) => (
          <div key={tramo.id} className="bg-slate-700/50 rounded-xl p-3 space-y-2 border border-slate-600/50">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Tramo {idx + 1}</span>
              {record.tramos.length > 1 && (
                <button type="button" onClick={() => removeTramo(recordId, tramo.id)}
                  className="text-slate-500 hover:text-red-400 text-sm leading-none">×</button>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Tipo de cable</label>
              <input type="text" value={tramo.tipoCable}
                onChange={(e) => updateTramo(recordId, tramo.id, { tipoCable: e.target.value })}
                placeholder="Ej. FO 24FO ADSS" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Metraje</label>
              <input type="text" value={tramo.metraje} inputMode="decimal"
                onChange={(e) => updateTramo(recordId, tramo.id, { metraje: e.target.value })}
                placeholder="Ej. 250" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Desde</label>
                <input type="text" value={tramo.desde}
                  onChange={(e) => updateTramo(recordId, tramo.id, { desde: e.target.value })}
                  placeholder="Lugar / poste" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Hasta</label>
                <input type="text" value={tramo.hasta}
                  onChange={(e) => updateTramo(recordId, tramo.id, { hasta: e.target.value })}
                  placeholder="Lugar / poste" className={inputCls} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Condiciones */}
      <div className="space-y-3 pt-2 border-t border-slate-700">
        <p className="text-xs font-medium text-slate-300">Condiciones del proyecto</p>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={record.instalaCMIC} onChange={(e) => update(recordId, { instalaCMIC: e.target.checked })} className={checkCls} />
          <span className="text-sm text-slate-200">Instala CMIC</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={record.instalaMufas} onChange={(e) => update(recordId, { instalaMufas: e.target.checked })} className={checkCls} />
          <span className="text-sm text-slate-200">Instala mufas</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={record.tieneReparacionDucto} onChange={(e) => update(recordId, { tieneReparacionDucto: e.target.checked })} className={checkCls} />
          <span className="text-sm text-slate-200">Incluye reparación de ducto</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={record.tieneIngresoRed} onChange={(e) => update(recordId, { tieneIngresoRed: e.target.checked })} className={checkCls} />
          <span className="text-sm text-slate-200">Ingreso a red</span>
        </label>

        {record.tieneIngresoRed && (
          <div className="ml-7 space-y-2 bg-slate-700/30 rounded-xl p-3 border border-slate-600/40">
            <p className="text-xs text-slate-400 font-medium mb-2">Datos de ingreso a red</p>
            {(['nodo', 'rack', 'odf', 'fo'] as const).map((field) => (
              <div key={field}>
                <label className="block text-xs text-slate-500 mb-1 capitalize">{field.toUpperCase()}</label>
                <input type="text" value={record.ingresoRed[field]}
                  onChange={(e) => update(recordId, { ingresoRed: { ...record.ingresoRed, [field]: e.target.value } })}
                  placeholder={`Ej. ${field === 'nodo' ? 'Nodo-001' : field === 'rack' ? 'R-12' : field === 'odf' ? 'ODF-A' : '001-002'}`}
                  className={inputCls} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hitos */}
      <div className="space-y-3 pt-2 border-t border-slate-700">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-300">Hitos del proyecto</p>
          <button type="button" onClick={() => addHito(recordId)}
            className="text-xs text-brand-400 hover:text-brand-300 font-medium">+ Agregar hito</button>
        </div>
        {record.hitos.length === 0 && (
          <p className="text-xs text-slate-500 italic">Sin hitos registrados.</p>
        )}
        {record.hitos.map((hito) => (
          <div key={hito.id} className="bg-slate-700/50 rounded-xl p-3 space-y-2 border border-slate-600/50">
            <div className="flex items-center justify-between">
              <label className="block text-xs text-slate-500 mb-0">Fecha (opcional)</label>
              <button type="button" onClick={() => removeHito(recordId, hito.id)}
                className="text-slate-500 hover:text-red-400 text-sm leading-none">×</button>
            </div>
            <input type="date" value={hito.fecha}
              onChange={(e) => updateHito(recordId, hito.id, { fecha: e.target.value })}
              className={inputCls} />
            <div>
              <label className="block text-xs text-slate-500 mb-1">Descripción</label>
              <input type="text" value={hito.descripcion}
                onChange={(e) => updateHito(recordId, hito.id, { descripcion: e.target.value })}
                placeholder="Ej. Inicio de obras" className={inputCls} />
            </div>
          </div>
        ))}
      </div>

      {/* Foto aérea */}
      <div className="pt-2 border-t border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-slate-300">Foto aérea / de calle</p>
          <div className="flex rounded-lg overflow-hidden border border-slate-600">
            <button type="button"
              onClick={() => update(recordId, { fotoAereaTipo: 'aerea' })}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${(record.fotoAereaTipo ?? 'aerea') === 'aerea' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              🛸 Aérea
            </button>
            <button type="button"
              onClick={() => update(recordId, { fotoAereaTipo: 'calle' })}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${record.fotoAereaTipo === 'calle' ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}>
              🛣 Calle
            </button>
          </div>
        </div>
        {record.fotoAerea?.previewUrl ? (
          <div className="relative rounded-xl overflow-hidden border border-slate-600">
            <img src={record.fotoAerea.previewUrl} alt="Foto aérea"
              className="w-full max-h-48 object-contain bg-slate-900" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-1.5 flex items-center justify-between">
              <span className="text-xs text-white">{record.fotoAereaTipo === 'calle' ? '🛣 Calle' : '🛸 Aérea'}</span>
              <button type="button" onClick={() => removeFotoAerea(recordId)}
                className="text-red-400 text-xs font-bold hover:text-red-300">✕ Quitar</button>
            </div>
          </div>
        ) : (
          <button type="button"
            onClick={() => aereoInputRef.current?.click()}
            disabled={loadingAereo}
            className="w-full h-24 rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/50 flex flex-col items-center justify-center gap-1 hover:border-brand-500 hover:bg-slate-700/50 transition-colors disabled:opacity-50">
            {loadingAereo
              ? <span className="animate-spin text-xl">⏳</span>
              : <><span className="text-2xl">🛸</span><span className="text-xs text-slate-400">Agregar foto aérea</span></>}
          </button>
        )}
        <input ref={aereoInputRef} type="file" accept="image/*" className="hidden" onChange={handleAereoCapture} />
      </div>
    </div>
  )
}
