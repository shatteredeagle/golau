// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isNewer, parseRelease, sumFor, Updater } from '../src/main/updater.ts'

test('version comparison', () => {
  assert.ok(isNewer('0.3.0', '0.2.2'))
  assert.ok(isNewer('v1.0.0', '0.9.9'))
  assert.ok(isNewer('0.2.10', '0.2.9'))
  assert.ok(!isNewer('0.2.2', '0.2.2'))
  assert.ok(!isNewer('0.2.1', '0.2.2'))
  assert.ok(!isNewer('0.3.0-beta.1', '0.2.2'), 'prereleases are never offered')
  assert.ok(!isNewer('garbage', '0.2.2'))
})

test('checksum lookup', () => {
  const sums = 'aaaa  other.exe\n' + 'b'.repeat(64) + '  Golau-Setup-0.3.0.exe\n'
  assert.equal(sumFor(sums, 'Golau-Setup-0.3.0.exe'), 'b'.repeat(64))
  assert.equal(sumFor(sums, 'Golau-Setup-9.9.9.exe'), undefined)
})

const PAYLOAD = Buffer.from('MZ fake installer bytes '.repeat(1000))
const SHA = createHash('sha256').update(PAYLOAD).digest('hex')
const asset = (name: string, size = 10) => ({
  name,
  size,
  browser_download_url: `https://github.com/shatteredeagle/golau/releases/download/v0.3.0/${name}`
})
const RELEASE = {
  tag_name: 'v0.3.0',
  body: 'notes',
  html_url: 'https://github.com/shatteredeagle/golau/releases/tag/v0.3.0',
  assets: [asset('Golau-Setup-0.3.0.exe', PAYLOAD.length), asset('SHA256SUMS.txt')]
}

function fakeFetch(opts: { sha?: string; release?: unknown; payloadHost?: string } = {}) {
  return async (url: string): Promise<Response> => {
    if (url.startsWith('https://api.github.com/')) return Response.json(opts.release ?? RELEASE)
    if (url.endsWith('SHA256SUMS.txt')) return new Response(`${opts.sha ?? SHA}  Golau-Setup-0.3.0.exe\n`)
    if (url.endsWith('.exe')) {
      const r = new Response(PAYLOAD)
      // simulate GitHub's redirect target for the asset
      Object.defineProperty(r, 'url', { value: `https://${opts.payloadHost ?? 'objects.githubusercontent.com'}/x/Golau-Setup-0.3.0.exe` })
      return r
    }
    return new Response('nope', { status: 404 })
  }
}

const make = (fetch: ReturnType<typeof fakeFetch>, current = '0.2.2') =>
  new Updater({ currentVersion: current, fetch, tempDir: mkdtempSync(join(tmpdir(), 'golau-upd-')), canInstall: false })

test('parseRelease ignores drafts/prereleases and releases without our assets', () => {
  assert.equal(parseRelease({ ...RELEASE, prerelease: true }), null)
  assert.equal(parseRelease({ ...RELEASE, assets: [asset('SHA256SUMS.txt')] }), null)
  assert.equal(parseRelease(RELEASE)?.installerName, 'Golau-Setup-0.3.0.exe')
})

test('check → available → download verifies the checksum → ready', async () => {
  const u = make(fakeFetch())
  assert.equal((await u.check()).state, 'available')
  const st = await u.download()
  assert.equal(st.state, 'ready', st.error)
  const file = join((u as unknown as { d: { tempDir: string } }).d.tempDir, 'golau-update', 'Golau-Setup-0.3.0.exe')
  assert.deepEqual(readFileSync(file), PAYLOAD)
  assert.equal(u.install(true), false, 'never runs an installer where installing is disabled')
})

test('already on the latest version → up to date', async () => {
  const u = make(fakeFetch(), '0.3.0')
  assert.equal((await u.check()).state, 'up-to-date')
})

test('a tampered download is rejected and deleted', async () => {
  const u = make(fakeFetch({ sha: 'f'.repeat(64) }))
  await u.check()
  const st = await u.download()
  assert.equal(st.state, 'error')
  assert.match(st.error ?? '', /checksum mismatch/)
  const dir = join((u as unknown as { d: { tempDir: string } }).d.tempDir, 'golau-update')
  assert.ok(!existsSync(join(dir, 'Golau-Setup-0.3.0.exe')))
})

test('downloads redirected to a non-GitHub host are refused', async () => {
  const u = make(fakeFetch({ payloadHost: 'evil.example' }))
  await u.check()
  const st = await u.download()
  assert.equal(st.state, 'error')
  assert.match(st.error ?? '', /refusing update URL/)
})

test('asset URLs outside GitHub are refused', async () => {
  const bad = { ...RELEASE, assets: [{ ...asset('Golau-Setup-0.3.0.exe', PAYLOAD.length), browser_download_url: 'http://evil.example/Golau-Setup-0.3.0.exe' }, asset('SHA256SUMS.txt')] }
  const u = make(fakeFetch({ release: bad }))
  await u.check()
  assert.equal((await u.download()).state, 'error')
})
