import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// app.dibia.app — offline-first PWA.
// The service worker precaches the app shell so the whole SPA boots with no network,
// which is the backbone of the offline requirement (writes are handled separately in src/data).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'Dibia Hospital Management System',
        short_name: 'Dibia',
        description: 'Hospital management, offline-first.',
        theme_color: '#0B6E6E',
        background_color: '#F7F6F3',
        display: 'standalone',
        start_url: '/',
        icons: [
          // SVG icon covers all sizes; swap in rasterised PNGs before store submission.
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built shell; SPA navigations fall back to index.html when offline.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    // Matches the "@/*" -> "src/*" alias in jsconfig.json (editor) so build and
    // editor agree. All app imports use "@/...".
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
