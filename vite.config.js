import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const env = globalThis?.process?.env ?? {}
const repoBase = '/AcornArena/'
const basePath =
  env.VITE_SITE_BASE != null
    ? env.VITE_SITE_BASE
    : env.NODE_ENV === 'production'
    ? repoBase
    : '/'

export default defineConfig({
  plugins: [react()],
  base: basePath,
})
