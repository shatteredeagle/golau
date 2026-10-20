import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

/** The app was called Tasklight before 0.2.0; its data lived in %APPDATA%\Tasklight. */
export const OLD_NAME = 'Tasklight'
export const OLD_APP_ID = 'com.tasklight.app'

/**
 * Everything that makes up a user's data. "Local State" holds Chromium's DPAPI-protected key
 * that safeStorage uses, so secrets.bin can only be decrypted if it moves along with it.
 */
export const MIGRATED_FILES = [
  'settings.json',
  'settings.json.bak',
  'state.json',
  'state.json.bak',
  'secrets.bin',
  'Local State'
]

/**
 * One-time copy from the old data folder. Runs before Electron initialises (so the key file is
 * picked up), only when the new folder has no settings yet, and never deletes the old folder.
 * Returns the files it copied.
 */
export function migrateFromOldName(oldDir: string, newDir: string): string[] {
  if (oldDir.toLowerCase() === newDir.toLowerCase()) return []
  if (!existsSync(join(oldDir, 'settings.json')) || existsSync(join(newDir, 'settings.json'))) return []
  mkdirSync(newDir, { recursive: true })
  const copied: string[] = []
  for (const f of MIGRATED_FILES) {
    const src = join(oldDir, f)
    if (!existsSync(src)) continue
    copyFileSync(src, join(newDir, f))
    copied.push(f)
  }
  return copied
}
