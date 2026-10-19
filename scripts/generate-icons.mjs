import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'public')

function icon(size, { maskable = false } = {}) {
  const scale = maskable ? 0.62 : 0.72
  const book = 512 * scale
  const x = (512 - book) / 2
  const y = (512 - book * 0.92) / 2
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#7d3228"/>
  <g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M48 36h286c32 0 64 20 64 56v332H118c-32 0-70-24-70-70V36z" fill="#f6ecd8"/>
    <path d="M118 150h196M118 214h196M118 278h132" stroke="#7d3228" stroke-width="22" stroke-linecap="round"/>
  </g>
</svg>`
}

await mkdir(out, { recursive: true })

const files = [
  ['pwa-192.png', 192, false],
  ['pwa-512.png', 512, false],
  ['pwa-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]

for (const [name, size, maskable] of files) {
  await sharp(Buffer.from(icon(size, { maskable }))).png().toFile(resolve(out, name))
}
