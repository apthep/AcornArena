import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const env = globalThis?.process?.env ?? {}
const basePath = env.VITE_SITE_BASE ?? (env.NODE_ENV === 'production' ? '/acornaarena/' : '/')

export default defineConfig({
  plugins: [react()],
  base: basePath,
})
