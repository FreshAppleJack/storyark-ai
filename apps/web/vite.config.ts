import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '')
  const port = Number(env.STORYARK_WEB_PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid STORYARK_WEB_PORT')
  const target = env.STORYARK_API_PROXY_TARGET || 'http://localhost:8080'
  if (!/^https?:\/\//i.test(target)) throw new Error('STORYARK_API_PROXY_TARGET must use HTTP(S)')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.STORYARK_WEB_HOST || '0.0.0.0',
      port,
      strictPort: true,
      // Preserve the browser-facing Host so Spring sees same-origin requests
      // even when a developer changes the local web port.
      proxy: { '/api': { target, changeOrigin: false } },
    },
  }
})
