import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { SettingsModel } from '../lib/models/settings.model'

const original: SettingsModel = {
  general: { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
  azDo: { organizationUrl: '', project: 'original', pat: '', updateInterval: 180, intelligentApproval: true },
  appearance: { theme: 'system', tableSize: 'small' } as SettingsModel['appearance'],
  profiles: [{ id: 'all', label: 'All', visible: true, enableAcceptAll: false, notifyOnNewPrs: false }],
}

function settingsModule(directory: string, overrides: Partial<typeof fs> = {}, platform = process.platform) {
  const source = ts.transpileModule(readFileSync('lib/main/settings.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const localRequire = createRequire(path.join(__dirname, '../lib/main/settings.js'))
  const result = {
    exports: {} as {
      saveSettings(input: SettingsModel): Promise<SettingsModel>
      loadSettings(): Promise<SettingsModel>
    },
  }
  let effects = 0
  runInNewContext(source, {
    module: result,
    exports: result.exports,
    Buffer,
    process: { platform },
    require: (name: string) => {
      if (name === 'node:fs/promises') return { ...fs, ...overrides }
      if (name === 'electron')
        return {
          app: {
            getPath: () => directory,
            getLoginItemSettings: () => ({ openAtLogin: false }),
            setLoginItemSettings: () => effects++,
          },
          safeStorage: {
            encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
            decryptString: (value: Buffer) => {
              const text = value.toString()
              if (!text.startsWith('encrypted:')) throw new Error('Invalid encrypted fixture')
              return text.slice('encrypted:'.length)
            },
          },
        }
      if (name === './tray') return { updateTrayProfiles: () => effects++ }
      return localRequire(name)
    },
  })
  return { ...result.exports, effects: () => effects }
}

for (const failure of ['partial write', 'file flush', 'rename', 'directory flush']) {
  test(
    `${failure} failure preserves the previous settings and permits the next queued save`,
    { skip: failure === 'directory flush' && process.platform === 'win32' },
    async (t) => {
      const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-'))
      t.after(() => fs.rm(directory, { recursive: true, force: true }))
      const file = path.join(directory, 'settings.json')
      await fs.writeFile(file, JSON.stringify(original), { mode: 0o600 })
      const before = await fs.readFile(file, 'utf8')
      let fail = true
      const expected = new Error(failure)
      const store = settingsModule(
        directory,
        {
          writeFile: async (filename, data, options) => {
            if (fail && failure === 'partial write') {
              fail = false
              await fs.writeFile(filename, '{"partial":', options)
              throw expected
            }
            await fs.writeFile(filename, data, options)
            if (fail && failure === 'file flush') {
              fail = false
              throw expected
            }
          },
          rename: async (...args) => {
            if (fail && failure === 'rename') {
              fail = false
              throw expected
            }
            return fs.rename(...args)
          },
          open: async (...args) => {
            const handle = await fs.open(...args)
            if (args[0] !== directory) return handle
            return new Proxy(handle, {
              get(target, key) {
                if (key === 'sync')
                  return async () => {
                    if (fail && failure === 'directory flush') {
                      fail = false
                      throw expected
                    }
                    return target.sync()
                  }
                const value = Reflect.get(target, key, target)
                return typeof value === 'function' ? value.bind(target) : value
              },
            })
          },
        },
        failure === 'directory flush' ? 'darwin' : process.platform
      )
      const cached = await store.loadSettings()
      await assert.rejects(
        store.saveSettings({ ...original, azDo: { ...original.azDo, project: 'failed' } }),
        (error) => error === expected
      )
      assert.equal(await fs.readFile(file, 'utf8'), before)
      assert.strictEqual(await store.loadSettings(), cached)
      assert.equal(store.effects(), 0)
      assert.deepEqual(await fs.readdir(directory), ['settings.json'])
      await store.saveSettings({ ...original, azDo: { ...original.azDo, project: 'recovered' } })
      assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).azDo.project, 'recovered')
    }
  )
}

test(
  'saves flush private staged data before replacement and flush the parent directory',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-order-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'settings.json')
    await fs.writeFile(file, JSON.stringify(original))
    const operations: string[] = []
    const store = settingsModule(
      directory,
      {
        writeFile: async (filename, data, options) => {
          assert.notEqual(filename, file)
          assert.equal(typeof options === 'object' && options?.mode, 0o600)
          assert.equal(typeof options === 'object' && options?.flag, 'wx')
          assert.equal(typeof options === 'object' && options?.flush, true)
          operations.push('write+flush')
          return fs.writeFile(filename, data, options)
        },
        rename: async (...args) => {
          operations.push('replace')
          return fs.rename(...args)
        },
        open: async (...args) => {
          const handle = await fs.open(...args)
          return new Proxy(handle, {
            get(target, key) {
              if (key === 'sync')
                return async () => {
                  operations.push('directory flush')
                  return target.sync()
                }
              const value = Reflect.get(target, key, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        },
      },
      'darwin'
    )
    await store.loadSettings()
    const input = { ...original, azDo: { ...original.azDo, pat: 'test-secret' } }
    await store.saveSettings(input)
    assert.deepEqual(operations, ['write+flush', 'replace', 'directory flush'])
    const saved = await fs.readFile(file, 'utf8')
    assert.ok(!saved.includes('test-secret'))
    assert.equal(input.azDo.pat, 'test-secret')
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    assert.equal((await settingsModule(directory).loadSettings()).azDo.pat, 'test-secret')
    assert.deepEqual(await fs.readdir(directory), ['settings.json'])
  }
)

test('initial reads share the save queue and remove an orphan stage without changing valid settings', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-startup-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'settings.json')
  await fs.writeFile(file, JSON.stringify(original))
  await fs.writeFile(`${file}.tmp`, '{"interrupted":')
  const store = settingsModule(directory)
  const reads = await Promise.all([store.loadSettings(), store.loadSettings(), store.loadSettings()])
  assert.ok(reads.every((value) => value === reads[0]))
  assert.equal(reads[0].azDo.project, 'original')
  assert.deepEqual(await fs.readdir(directory), ['settings.json'])
  assert.equal(store.effects(), 0)
})

test(
  'a directory flush failure on the first save restores the absence of a settings file',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-new-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    let fail = true
    const store = settingsModule(
      directory,
      {
        open: async (...args) => {
          const handle = await fs.open(...args)
          return new Proxy(handle, {
            get(target, key) {
              if (key === 'sync')
                return async () => {
                  if (fail) {
                    fail = false
                    throw new Error('directory flush failed')
                  }
                  return target.sync()
                }
              const value = Reflect.get(target, key, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        },
      },
      'darwin'
    )
    await assert.rejects(store.saveSettings(original), /directory flush failed/)
    assert.deepEqual(await fs.readdir(directory), [])
    await store.saveSettings(original)
    assert.equal((await store.loadSettings()).azDo.project, 'original')
  }
)

test('Windows flushes staged files without attempting an unsupported directory handle', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-windows-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = settingsModule(
    directory,
    {
      open: async (...args) => {
        if (args[0] === directory) throw new Error('directory handles unsupported')
        return fs.open(...args)
      },
    },
    'win32'
  )
  await store.saveSettings(original)
  assert.equal((await store.loadSettings()).azDo.project, 'original')
  assert.deepEqual(await fs.readdir(directory), ['settings.json'])
})

for (const phase of ['before', 'after']) {
  test(`a process killed ${phase} replacement restarts with complete settings`, { timeout: 10000 }, async (t) => {
    const directory = await fs.mkdtemp(path.join(realpathSync(tmpdir()), 'pr-manager-smoke-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'settings.json')
    await fs.writeFile(file, JSON.stringify(original), { mode: 0o600 })
    const child = fork(path.resolve('tests/settings-crash-worker.mjs'), [directory, phase], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    })
    let stderr = ''
    child.stderr!.on('data', (chunk) => {
      stderr += chunk
    })
    const milestone = await Promise.race([
      once(child, 'message').then(([message]) => message),
      once(child, 'exit').then(([code]) => {
        throw new Error(`Worker exited (${code}): ${stderr}`)
      }),
    ])
    assert.equal(milestone, phase)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const restarted = await settingsModule(directory).loadSettings()
    assert.equal(restarted.azDo.project, phase === 'before' ? 'original' : 'replacement')
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).azDo.project, restarted.azDo.project)
    assert.deepEqual(await fs.readdir(directory), ['settings.json'])
  })
}

test(
  'rollback failure reports both failures and retains a private recovery copy',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-rollback-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'settings.json')
    await fs.writeFile(file, JSON.stringify(original), { mode: 0o600 })
    const before = await fs.readFile(file, 'utf8')
    let renames = 0
    const store = settingsModule(
      directory,
      {
        rename: async (...args) => {
          if (++renames === 2) throw new Error('rollback rename failed')
          return fs.rename(...args)
        },
        open: async (...args) => {
          const handle = await fs.open(...args)
          return new Proxy(handle, {
            get(target, key) {
              if (key === 'sync')
                return async () => {
                  throw new Error('directory flush failed')
                }
              const value = Reflect.get(target, key, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        },
      },
      'darwin'
    )
    await store.loadSettings()
    await assert.rejects(
      store.saveSettings({ ...original, azDo: { ...original.azDo, project: 'replacement' } }),
      (error: unknown) => {
        const failure = error as AggregateError
        assert.match(failure.message, /Settings rollback failed/)
        assert.deepEqual(
          Array.from(failure.errors, (item: Error) => item.message),
          ['directory flush failed', 'rollback rename failed']
        )
        return true
      }
    )
    assert.equal(await fs.readFile(`${file}.rollback`, 'utf8'), before)
    assert.equal((await fs.stat(`${file}.rollback`)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).azDo.project, 'replacement')
    assert.equal((await store.loadSettings()).azDo.project, 'original')
    assert.equal((await settingsModule(directory).loadSettings()).azDo.project, 'original')
    assert.equal(await fs.readFile(file, 'utf8'), before)
    assert.deepEqual(await fs.readdir(directory), ['settings.json'])
  }
)

test('read and initialization errors never reset an existing settings file', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-read-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'settings.json')
  const bytes = JSON.stringify(original)
  await fs.writeFile(file, bytes)
  const denied = Object.assign(new Error('access denied'), { code: 'EACCES' })
  const store = settingsModule(directory, {
    readFile: async () => {
      throw denied
    },
  })
  await assert.rejects(store.loadSettings(), (error) => error === denied)
  assert.equal(await fs.readFile(file, 'utf8'), bytes)
  assert.equal(store.effects(), 0)
})

test('an incomplete recovery file is preserved without overwriting complete settings', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-incomplete-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'settings.json')
  const bytes = JSON.stringify(original)
  await fs.writeFile(file, bytes)
  await fs.writeFile(`${file}.rollback`, '{"interrupted":', { mode: 0o600 })
  await assert.rejects(settingsModule(directory).loadSettings(), { name: 'SyntaxError' })
  assert.equal(await fs.readFile(file, 'utf8'), bytes)
  assert.equal(await fs.readFile(`${file}.rollback`, 'utf8'), '{"interrupted":')
})

for (const recovery of [
  {},
  { ...original, azDo: { ...original.azDo, pat: Buffer.from('corrupt').toString('base64url') } },
]) {
  test('unusable recovery settings never replace a complete settings file', async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-unusable-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'settings.json')
    const bytes = JSON.stringify(original)
    const recoveryBytes = JSON.stringify(recovery)
    await fs.writeFile(file, bytes)
    await fs.writeFile(`${file}.rollback`, recoveryBytes, { mode: 0o600 })
    await assert.rejects(settingsModule(directory).loadSettings())
    assert.equal(await fs.readFile(file, 'utf8'), bytes)
    assert.equal(await fs.readFile(`${file}.rollback`, 'utf8'), recoveryBytes)
  })
}

test('recovery is flushed before replacing settings and never reports success on a failed recovery flush', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-atomic-reflush-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'settings.json')
  const originalBytes = JSON.stringify({ ...original, azDo: { ...original.azDo, project: 'new' } })
  await fs.writeFile(file, originalBytes)
  await fs.writeFile(`${file}.rollback`, JSON.stringify(original), { mode: 0o600 })
  let flushed = false
  let fail = true
  const store = settingsModule(directory, {
    open: async (...args) => {
      const handle = await fs.open(...args)
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'sync' && args[0] === `${file}.rollback`)
            return async () => {
              if (fail) {
                fail = false
                throw new Error('Recovery flush failed')
              }
              await target.sync()
              flushed = true
            }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
    rename: async (...args) => {
      assert.equal(flushed, true)
      return fs.rename(...args)
    },
  })
  await assert.rejects(store.loadSettings(), /Recovery flush failed/)
  assert.equal(await fs.readFile(file, 'utf8'), originalBytes)
  assert.equal((await store.loadSettings()).azDo.project, 'original')
  assert.deepEqual(await fs.readdir(directory), ['settings.json'])
})
