import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'

// admin.dibia.app — Dibia's own internal control panel.
// Unlike the hospital app, the console is an always-online HQ tool (no PWA /
// offline shell): it reads and writes the platform's central records, so there
// is nothing to precache for offline use.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the "@/*" -> "src/*" alias in jsconfig.json so build and editor agree.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5174 }, // 5173 is the hospital app; run both side by side.
})
