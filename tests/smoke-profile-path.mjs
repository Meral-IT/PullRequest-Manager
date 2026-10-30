import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const temporaryRoot = realpathSync(tmpdir())

export function validateSmokeProfilePath(userData) {
  const directoryName = typeof userData === 'string' ? basename(userData) : ''
  const profilePath = join(temporaryRoot, directoryName)
  if (
    userData !== profilePath ||
    !/^pr-manager-smoke-[A-Za-z0-9]{6}$/.test(directoryName) ||
    !lstatSync(profilePath, { throwIfNoEntry: false })?.isDirectory()
  ) {
    throw new Error('Invalid smoke profile directory')
  }
  return profilePath
}

export function withSmokeProfile(run) {
  const userData = mkdtempSync(join(temporaryRoot, 'pr-manager-smoke-'))
  try {
    return run(userData)
  } finally {
    // Chromium must exit before Windows releases its profile file locks.
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
