import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { profileToolPaths, sourceSha256 } from '../scripts/profile/tools.mjs'

test('profile tools use fixed absolute installation paths and reject unsupported platforms', () => {
  assert.deepEqual(profileToolPaths('darwin'), { gitExecutable: '/usr/bin/git' })
  assert.deepEqual(profileToolPaths('win32'), {
    gitExecutable: String.raw`C:\Program Files\Git\cmd\git.exe`,
    taskkillExecutable: String.raw`C:\Windows\System32\taskkill.exe`,
  })
  assert.throws(() => profileToolPaths('linux'), /native macOS or Windows/)
})

test('source hash keeps manifest order when parallel reads finish out of order', { timeout: 1000 }, async (t) => {
  const root = path.resolve('fixture')
  const releaseFirst = Promise.withResolvers()
  const completedReads = []
  t.mock.method(fs, 'readFile', async (filename) => {
    if (filename === path.join(root, 'app/a.txt')) {
      await releaseFirst.promise
      completedReads.push('a')
      return Buffer.from('first')
    }
    assert.equal(filename, path.join(root, 'app/z.txt'))
    completedReads.push('z')
    releaseFirst.resolve()
    return Buffer.from('last')
  })
  assert.equal(
    await sourceSha256(root, ['app/a.txt', 'app/z.txt']),
    createHash('sha256').update('app/a.txtfirstapp/z.txtlast').digest('hex')
  )
  assert.deepEqual(completedReads, ['z', 'a'])
})

test('source hash propagates file read errors', async (t) => {
  t.mock.method(fs, 'readFile', async () => {
    throw new Error('fixture read failed')
  })
  await assert.rejects(sourceSha256(path.resolve('fixture'), ['missing.txt']), /fixture read failed/)
})
