import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'

// Después de un deploy nuevo, una pestaña que ya estaba abierta sigue con el
// mapa de módulos viejo: si recién ahí carga un chunk que se importa dinámico
// (ej. exceljs, solo al usar Excel), pide un archivo con el hash de ANTES,
// que el deploy nuevo ya borró — "error loading dynamically imported module".
// Vite dispara este evento en ese caso exacto; recargar la página trae el
// mapa de módulos nuevo. Guard con sessionStorage para no entrar en loop si
// el reload no lo arregla (ej. sin conexión) — se limpia apenas el bundle
// actual carga bien, así un futuro deploy nuevo vuelve a tener su reintento.
sessionStorage.removeItem('reload-tras-preload-error')
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('reload-tras-preload-error')) return
  sessionStorage.setItem('reload-tras-preload-error', '1')
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
