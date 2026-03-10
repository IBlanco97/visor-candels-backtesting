/**
 * Post-build step for Electron packaging.
 *
 * Next.js standalone output omits two directories that the server needs at runtime:
 *   1. .next/static  → must be copied to .next/standalone/.next/static
 *   2. public/       → must be copied to .next/standalone/public
 *
 * Run AFTER `next build`:
 *   node scripts/prepare-electron.js
 */

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  [skip] ${src} does not exist`)
    return
  }
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

console.log('Preparing Electron build...')

const staticSrc  = path.join(root, '.next', 'static')
const staticDest = path.join(root, '.next', 'standalone', '.next', 'static')
console.log(`  Copying .next/static → standalone/.next/static`)
copyDir(staticSrc, staticDest)

const publicSrc  = path.join(root, 'public')
const publicDest = path.join(root, '.next', 'standalone', 'public')
console.log(`  Copying public/ → standalone/public/`)
copyDir(publicSrc, publicDest)

console.log('Done.')
