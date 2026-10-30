import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import test from 'node:test'
import { profileTemporaryRoot, readProfileConfig } from '../scripts/profile/config.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(profileTemporaryRoot, 'prm-profile-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const configPath = join(directory, 'config.json')
  const config = {
    count: 32,
    run: 1,
    cycles: 3,
    userData: join(directory, 'user-data'),
    result: join(directory, 'result.json'),
    launchedAtMs: Date.now(),
  }
  mkdirSync(config.userData)
  writeFileSync(join(config.userData, 'settings.json'), '{}')
  writeFileSync(configPath, JSON.stringify(config))
  return { directory, configPath, config }
}

test('accepts only generated canonical config and fixed existing settings paths', (t) => {
  const { configPath, config } = fixture(t)
  assert.deepEqual(readProfileConfig(configPath), config)
  for (const count of [0, 32, 1000, 10000]) {
    writeFileSync(configPath, JSON.stringify({ ...config, count, run: 2 }))
    assert.equal(readProfileConfig(configPath).count, count)
  }
  writeFileSync(configPath, JSON.stringify(config))
  writeFileSync(config.result, '{}')
  assert.deepEqual(readProfileConfig(configPath), config)
})

test('refuses relative, outside, noncanonical and unbounded configuration before writing', (t) => {
  const { configPath, config, directory } = fixture(t)
  const original = readFileSync(join(config.userData, 'settings.json'), 'utf8')
  for (const candidate of [
    undefined,
    '',
    basename(configPath),
    directory,
    join(profileTemporaryRoot, 'config.json'),
    `${directory}/./config.json`,
    `${directory}/../${basename(directory)}/config.json`,
  ]) {
    assert.throws(() => readProfileConfig(candidate), /Invalid packaged profile/)
  }
  for (const changed of [
    { userData: profileTemporaryRoot },
    { result: join(profileTemporaryRoot, 'result.json') },
    { count: 10001 },
    { count: '32' },
    { run: 3 },
    { cycles: 100 },
    { launchedAtMs: -1 },
  ]) {
    writeFileSync(configPath, JSON.stringify({ ...config, ...changed }))
    assert.throws(() => readProfileConfig(configPath), /Invalid packaged profile/)
  }
  for (const contents of ['not-json', 'null', '[]', '{}']) {
    writeFileSync(configPath, contents)
    assert.throws(() => readProfileConfig(configPath), /Invalid packaged profile/)
  }
  assert.equal(readFileSync(join(config.userData, 'settings.json'), 'utf8'), original)
})

test('refuses symlinked generated directories and user-data directories', (t) => {
  const target = fixture(t)
  for (const child of [false, true]) {
    const link = fixture(t)
    const destination = child ? link.config.userData : link.directory
    rmSync(destination, { recursive: true })
    symlinkSync(
      child ? target.config.userData : target.directory,
      destination,
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    assert.throws(() => readProfileConfig(link.configPath), /Invalid packaged profile/)
    assert.equal(readFileSync(join(target.config.userData, 'settings.json'), 'utf8'), '{}')
  }
})

test('refuses symlinked config, settings, result and unexpected existing profile contents', (t) => {
  const target = fixture(t)
  for (const filename of ['config.json', 'user-data/settings.json', 'result.json']) {
    const link = fixture(t)
    const candidate = join(link.directory, filename)
    rmSync(candidate, { force: true })
    try {
      symlinkSync(target.configPath, candidate, 'file')
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('Windows host does not permit file symlinks')
        return
      }
      throw error
    }
    assert.throws(() => readProfileConfig(link.configPath), /Invalid packaged profile/)
  }
  const extra = fixture(t)
  mkdirSync(join(extra.config.userData, 'unexpected'))
  assert.throws(() => readProfileConfig(extra.configPath), /Invalid packaged profile/)
})
