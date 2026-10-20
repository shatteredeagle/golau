// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFromOldName } from '../src/main/migrate.ts'

function dirs() {
  const root = mkdtempSync(join(tmpdir(), 'golau-migrate-'))
  return { oldDir: join(root, 'Tasklight'), newDir: join(root, 'Golau') }
}

test('copies settings, state, token and the key file from the old folder', () => {
  const { oldDir, newDir } = dirs()
  mkdirSync(oldDir)
  for (const f of ['settings.json', 'state.json', 'secrets.bin', 'Local State']) writeFileSync(join(oldDir, f), `old ${f}`)
  writeFileSync(join(oldDir, 'Cache'), 'not copied')
  const copied = migrateFromOldName(oldDir, newDir)
  assert.deepEqual(copied.sort(), ['Local State', 'secrets.bin', 'settings.json', 'state.json'])
  assert.equal(readFileSync(join(newDir, 'secrets.bin'), 'utf8'), 'old secrets.bin')
  assert.ok(!existsSync(join(newDir, 'Cache')))
  assert.ok(existsSync(join(oldDir, 'settings.json')), 'old folder is left alone')
})

test('never overwrites an existing Golau setup', () => {
  const { oldDir, newDir } = dirs()
  mkdirSync(oldDir)
  mkdirSync(newDir)
  writeFileSync(join(oldDir, 'settings.json'), 'old')
  writeFileSync(join(newDir, 'settings.json'), 'new')
  assert.deepEqual(migrateFromOldName(oldDir, newDir), [])
  assert.equal(readFileSync(join(newDir, 'settings.json'), 'utf8'), 'new')
})

test('does nothing when there was no old install', () => {
  const { oldDir, newDir } = dirs()
  assert.deepEqual(migrateFromOldName(oldDir, newDir), [])
  assert.ok(!existsSync(newDir))
})
