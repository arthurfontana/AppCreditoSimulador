import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Config de testes — separada do vite.config.js (que injeta metadados de build via git).
// Os guards `typeof __BUILD_*__ !== "undefined"` em App.jsx cobrem a ausência dos defines aqui.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{js,jsx}'],
  },
})
