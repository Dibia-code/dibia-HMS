import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || `${Date.now()}`
const buildInfoPlugin = {
  name: 'dibia-build-info',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ buildId }) })
  },
}

// app.dibia.app — offline-first PWA.
// Precache the shell; app data is handled separately.
export default defineConfig({
  plugins: [
    react(),
    buildInfoPlugin,
    VitePWA({
      registerType: 'prompt',
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
          // SVG icons scale to every size.
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the shell and preserve API requests.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  resolve: {
    // Match the editor's @/* alias.
    alias: [
      { find: /^react$/, replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url)) },
      { find: /^react-router-dom$/, replacement: fileURLToPath(new URL('./node_modules/react-router-dom/dist/index.js', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
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
