// Writes out/THIRD_PARTY_NOTICES.txt: the license text of every library bundled into the app.
// Electron and Chromium ship their own (LICENSE.electron.txt, LICENSES.chromium.html).
// Run as part of `npm run build`; fails if a bundled package has no license file.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Runtime packages that Vite bundles into the renderer (everything else is build tooling).
const BUNDLED = ['react', 'react-dom', 'scheduler', 'dompurify', 'lucide-react']

const root = new URL('..', import.meta.url).pathname
const parts = [
  'Tasklight bundles the following third-party software.',
  'Tasklight itself is licensed under GPL-3.0-or-later (see LICENSE).',
  ''
]

for (const name of BUNDLED) {
  const dir = join(root, 'node_modules', name)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  if (!file) throw new Error(`no license file for ${name}`)
  parts.push('='.repeat(78), `${name} ${pkg.version}  (${pkg.license})`, pkg.homepage ?? '', '-'.repeat(78), readFileSync(join(dir, file), 'utf8').trim(), '')
}

mkdirSync(join(root, 'out'), { recursive: true })
writeFileSync(join(root, 'out', 'THIRD_PARTY_NOTICES.txt'), parts.join('\n'))
console.log(`notices: ${BUNDLED.length} packages → out/THIRD_PARTY_NOTICES.txt`)
