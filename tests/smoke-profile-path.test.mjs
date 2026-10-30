import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { validateSmokeProfilePath, withSmokeProfile } from './smoke-profile-path.mjs'

const temporaryRoot = realpathSync(tmpdir())

function temporaryDirectory(t, prefix = 'pr-manager-smoke-') {
  const directory = mkdtempSync(join(temporaryRoot, prefix))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('accepts an existing canonical smoke profile directly inside the temporary directory', (t) => {
  const userData = temporaryDirectory(t)
  assert.equal(validateSmokeProfilePath(userData), userData)
})

test('refuses missing, relative, and noncanonical smoke profile paths', (t) => {
  const userData = temporaryDirectory(t)
  for (const candidate of [
    undefined,
    null,
    '',
    basename(userData),
    `${userData}/`,
    `${temporaryRoot}/./${basename(userData)}`,
  ]) {
    assert.throws(() => validateSmokeProfilePath(candidate), /Invalid smoke profile directory/)
  }
})

test('refuses profiles outside the temporary root or without a generated smoke name', (t) => {
  const otherDirectory = temporaryDirectory(t, 'pr-manager-unrelated-')
  const nestedProfile = mkdtempSync(join(otherDirectory, 'pr-manager-smoke-'))
  const malformedName = temporaryDirectory(t, 'pr-manager-smoke-extra-')
  for (const candidate of [
    temporaryRoot,
    otherDirectory,
    nestedProfile,
    malformedName,
    join(temporaryRoot, 'pr-manager-smoke-missing'),
  ]) {
    assert.throws(() => validateSmokeProfilePath(candidate), /Invalid smoke profile directory/)
  }
  assert.equal(existsSync(otherDirectory), true)
  assert.equal(existsSync(nestedProfile), true)
})

test('refuses symlinks and files even when they have generated smoke names', (t) => {
  const target = temporaryDirectory(t)
  const link = temporaryDirectory(t)
  rmSync(link, { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => validateSmokeProfilePath(link), /Invalid smoke profile directory/)
  assert.equal(existsSync(target), true)

  const file = temporaryDirectory(t)
  rmSync(file, { recursive: true })
  writeFileSync(file, 'keep')
  assert.throws(() => validateSmokeProfilePath(file), /Invalid smoke profile directory/)
  assert.equal(existsSync(file), true)
})

test('creates a valid canonical profile and cleans only that owned directory', (t) => {
  const unrelatedDirectory = temporaryDirectory(t, 'pr-manager-unrelated-')
  let ownedDirectory
  const result = withSmokeProfile((userData) => {
    ownedDirectory = userData
    assert.equal(userData, realpathSync(userData))
    assert.equal(validateSmokeProfilePath(userData), userData)
    writeFileSync(join(userData, 'profile.json'), '{}')
    return unrelatedDirectory
  })
  assert.equal(result, unrelatedDirectory)
  assert.equal(existsSync(ownedDirectory), false)
  assert.equal(existsSync(unrelatedDirectory), true)
})

test('cleans the owned profile when launching Electron throws', () => {
  let ownedDirectory
  const failure = new Error('launch failed')
  assert.throws(
    () =>
      withSmokeProfile((userData) => {
        ownedDirectory = userData
        throw failure
      }),
    (error) => error === failure
  )
  assert.equal(existsSync(ownedDirectory), false)
})
