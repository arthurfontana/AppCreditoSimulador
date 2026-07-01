import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function getBuildMeta() {
  try {
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
    const hash  = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
    const author = execSync('git log -1 --format="%an"', { encoding: 'utf8' }).trim()
    return { count, hash, branch, author }
  } catch {
    return { count: '0', hash: 'unknown', branch: 'unknown', author: 'unknown' }
  }
}

const meta = getBuildMeta()

// Fase 2 (Otimização de Memória) — habilita *cross-origin isolation* no app servido
// (dev e preview). Sem esses headers, `crossOriginIsolated` é false e o
// `SharedArrayBuffer` não pode ser compartilhado com o worker: a base colunar cairia
// no clone (cópia) do structured clone. Com eles, o csvStore SAB-backed é lido por
// main e worker sem duplicar a base no postMessage (ver src/columnar.js). Todos os
// assets são bundlados (mesma origem), então require-corp não bloqueia nada.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  define: {
    __BUILD_NUMBER__: JSON.stringify(meta.count),
    __BUILD_TIME__:   JSON.stringify(new Date().toISOString()),
    __BUILD_HASH__:   JSON.stringify(meta.hash),
    __BUILD_BRANCH__: JSON.stringify(meta.branch),
    __BUILD_AUTHOR__: JSON.stringify(meta.author),
  },
})
