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

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(meta.count),
    __BUILD_TIME__:   JSON.stringify(new Date().toISOString()),
    __BUILD_HASH__:   JSON.stringify(meta.hash),
    __BUILD_BRANCH__: JSON.stringify(meta.branch),
    __BUILD_AUTHOR__: JSON.stringify(meta.author),
  },
})
