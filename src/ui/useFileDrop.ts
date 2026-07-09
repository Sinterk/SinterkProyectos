// Hook compartido para permitir arrastrar archivos (fotos, .xlsx, .zip) sobre
// cualquier zona de subida, además del click-to-browse existente. Usa un
// contador de dragenter/dragleave (en vez de comparar target===currentTarget)
// porque los hijos internos del dropzone disparan esos eventos al pasar el
// cursor sobre ellos, y comparar target parpadearía el estado "arrastrando".

import { useCallback, useRef, useState } from 'react'

export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false)
  const counter = useRef(0)

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    counter.current += 1
    setIsDragging(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    counter.current = Math.max(0, counter.current - 1)
    if (counter.current === 0) setIsDragging(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    counter.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length > 0) onFiles(files)
  }, [onFiles])

  return { isDragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
