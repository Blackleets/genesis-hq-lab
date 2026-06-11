import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const alias = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core':       alias('core'),
      '@services':   alias('services'),
      '@animations': alias('animations'),
      '@agents':     alias('agents'),
      '@dashboard':  alias('dashboard'),
      '@activity':   alias('activity'),
      '@creator':    alias('creator'),
      '@workflows':  alias('workflows'),
      '@ui':         alias('ui'),
      '@hooks':      alias('hooks'),
      '@office':     alias('office'),
      '@components': alias('components'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
