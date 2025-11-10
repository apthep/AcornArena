import { copyFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const source = resolve('dist/index.html')
const destination = resolve('dist/404.html')

if (!existsSync(source)) {
  console.error('[create-404] Missing dist/index.html. Run "npm run build" first.')
  process.exit(1)
}

try {
  copyFileSync(source, destination)
  console.log('[create-404] Created dist/404.html for GitHub Pages fallback.')
} catch (error) {
  console.error('[create-404] Failed to create fallback:', error)
  process.exit(1)
}

