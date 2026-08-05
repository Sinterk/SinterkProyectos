import { useEffect } from 'react'

const APP_TITLE = 'SinterkProyectos'

/** Pone `title` como título de la pestaña del navegador mientras el componente
 *  esté montado (ej. el identificador principal de lo que se está editando —
 *  OTT, código, etc.) — vuelve al título por defecto al desmontar. `undefined`
 *  deja el título por defecto sin tocarlo. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${APP_TITLE}` : APP_TITLE
    return () => { document.title = APP_TITLE }
  }, [title])
}
