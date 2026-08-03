import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Carga el certificado mkcert si existe; si no, Vite usa HTTP normal
function loadCerts() {
  const key  = path.resolve(__dirname, 'certs/local-key.pem')
  const cert = path.resolve(__dirname, 'certs/local-cert.pem')
  if (fs.existsSync(key) && fs.existsSync(cert)) {
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
  }
  return undefined
}
const https = loadCerts()

// Versión visible en la UI. Súbela en cada deploy para verificar (junto al
// timestamp de build) que el service worker realmente cargó el bundle nuevo.
const APP_VERSION = 'v1.16'

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'SinterkProyectos',
        short_name: 'SinterkProy',
        description: 'Catálogo fotográfico de proyectos de telecomunicaciones',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        lang: 'es',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,  // 3 MB
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/proxy/],
      },
    }),
  ],
  server:  { host: true, https },
  preview: { host: true, https },
  resolve: {
    alias: {
      '@': '/src',
      // ExcelJS browser UMD bundle — sin dependencias core-js externas
      'exceljs': path.resolve('./node_modules/exceljs/dist/exceljs.bare.js'),
    },
  },
})
