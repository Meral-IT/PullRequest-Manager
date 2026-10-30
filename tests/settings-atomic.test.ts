/// <reference types="electron-vite/node" />

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
import type * as Settings from '../lib/main/settings'
import type { SettingsModel } from '../lib/models/settings.model'

const original: SettingsModel = {
  general: { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
  azDoIntegrations: [
    {
      id: 'integration',
      name: 'Test',
      organizationUrl: '',
      project: 'original',
      pat: '',
      updateInterval: 180,
      intelligentApproval: true,
    },
  ],
  appearance: { theme: 'system', tableSize: 'small' } as SettingsModel['appearance'],
  profiles: [{ id: 'all', label: 'All', visible: true, enableAcceptAll: false, notifyOnNewPrs: false }],
}

function settingsModule(directory: string, overrides: Partial<typeof fs> = {}, platform = process.platform) {
  const source = ts.transpileModule(readFileSync('lib/main/settings.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const localRequire = createRequire(path.join(__dirname, '../lib/main/settings.js'))
  const result = {
    exports: {} as Pick<typeof Settings, 'saveSettings' | 'loadSettings'>,
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

test('legacy Azure DevOps settings migrate automatically with encrypted PAT and stable identity', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-migration-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'settings.json')
  const legacy = {
    ...original,
    azDoIntegrations: undefined,
    azDo: {
      organizationUrl: 'https://dev.azure.com/example',
      project: 'Platform',
      pat: Buffer.from('encrypted:secret').toString('base64url'),
      updateInterval: 42,
      intelligentApproval: false,
      acknowledgedScopeRequirements: 'reviewed',
    },
  }
  await fs.writeFile(file, JSON.stringify(legacy))
  const settings = await settingsModule(directory).loadSettings()
  const integration = settings.azDoIntegrations[0]
  assert.ok(integration.id)
  assert.equal(integration.pat, 'secret')
  assert.equal(integration.updateInterval, 42)
  assert.equal(integration.intelligentApproval, false)
  assert.equal(integration.acknowledgedScopeRequirements, 'reviewed')
  const disk = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(disk.azDo, undefined)
  assert.notEqual(disk.azDoIntegrations[0].pat, 'secret')
  assert.equal((await settingsModule(directory).loadSettings()).azDoIntegrations[0].id, integration.id)
})

test('migration accepts refresh intervals saved as strings by the previous settings form', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-migration-interval-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  for (const [interval, expected] of [
    ['60', 60],
    ['', 180],
    ['invalid', 180],
    ['0', 180],
    ['3001', 180],
  ] as const) {
    const legacy = {
      ...original,
      azDoIntegrations: undefined,
      azDo: { ...original.azDoIntegrations[0], updateInterval: interval },
    }
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(legacy))
    const loaded = await settingsModule(directory).loadSettings()
    assert.equal(loaded.azDoIntegrations[0].updateInterval, expected)
  }
})

test('multiple integrations round-trip encrypted tokens and deleting all does not resurrect legacy config', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-integrations-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = settingsModule(directory)
  const input = {
    ...original,
    azDoIntegrations: ['first', 'second'].map((id) => ({ ...original.azDoIntegrations[0], id, pat: `${id}-secret` })),
  }
  await store.saveSettings(input)
  const bytes = await fs.readFile(path.join(directory, 'settings.json'), 'utf8')
  assert.equal(bytes.includes('first-secret'), false)
  assert.equal(bytes.includes('second-secret'), false)
  const loaded = await settingsModule(directory).loadSettings()
  assert.equal(loaded.azDoIntegrations[0].pat, 'first-secret')
  assert.equal(loaded.azDoIntegrations[1].pat, 'second-secret')
  assert.equal(input.azDoIntegrations[0].pat, 'first-secret')
  await assert.rejects(
    store.saveSettings({ ...input, azDoIntegrations: [input.azDoIntegrations[0], input.azDoIntegrations[0]] }),
    /unique IDs/
  )
  assert.equal(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'), bytes)
  await store.saveSettings({ ...input, azDoIntegrations: [] })
  assert.equal((await settingsModule(directory).loadSettings()).azDoIntegrations.length, 0)
})

test('migration preserves invalid profile filters for repair and leaves legacy bytes intact on write failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pr-migration-failure-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'settings.json')
  const legacy = {
    ...original,
    azDoIntegrations: undefined,
    azDo: { project: 'Legacy' },
    profiles: [{ ...original.profiles[0], filter: { op: 'INVALID' } }],
  }
  const bytes = JSON.stringify(legacy)
  await fs.writeFile(file, bytes)
  const failing = settingsModule(directory, {
    rename: async () => {
      throw new Error('Migration rename failed')
    },
  })
  await assert.rejects(failing.loadSettings(), /Migration rename failed/)
  assert.equal(await fs.readFile(file, 'utf8'), bytes)
  const loaded = await settingsModule(directory).loadSettings()
  assert.equal(loaded.azDoIntegrations[0].project, 'Legacy')
  assert.equal(loaded.azDoIntegrations[0].pat, '')
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.profiles[0].filter)), { op: 'INVALID' })
})

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
        store.saveSettings({ ...original, azDoIntegrations: [{ ...original.azDoIntegrations[0], project: 'failed' }] }),
        (error) => error === expected
      )
      assert.equal(await fs.readFile(file, 'utf8'), before)
      assert.strictEqual(await store.loadSettings(), cached)
      assert.equal(store.effects(), 0)
      assert.deepEqual(await fs.readdir(directory), ['settings.json'])
      await store.saveSettings({
        ...original,
        azDoIntegrations: [{ ...original.azDoIntegrations[0], project: 'recovered' }],
      })
      assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).azDoIntegrations[0].project, 'recovered')
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
    const input = { ...original, azDoIntegrations: [{ ...original.azDoIntegrations[0], pat: 'test-secret' }] }
    await store.saveSettings(input)
    assert.deepEqual(operations, ['write+flush', 'replace', 'directory flush'])
    const saved = await fs.readFile(file, 'utf8')
    assert.ok(!saved.includes('test-secret'))
    assert.equal(input.azDoIntegrations[0].pat, 'test-secret')
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    assert.equal((await settingsModule(directory).loadSettings()).azDoIntegrations[0].pat, 'test-secret')
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
  assert.equal(reads[0].azDoIntegrations[0].project, 'original')
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
    assert.equal((await store.loadSettings()).azDoIntegrations[0].project, 'original')
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
  assert.equal((await store.loadSettings()).azDoIntegrations[0].project, 'original')
  assert.deepEqual(await fs.readdir(directory), ['settings.json'])
})

for (const phase of ['before', 'after']) {
  test(`a process killed ${phase} replacement restarts with complete settings`, { timeout: 10000 }, async (t) => {
    const directory = await fs.mkdtemp(path.join(realpathSync(tmpdir()), 'pr-manager-smoke-'))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'settings.json')
    await fs.writeFile(file, JSON.stringify(original), { mode: 0o600 })
    const child = fork(path.resolve('tests/settings-crash-worker.mjs'), [directory, phase], {
      cwd: directory,
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
    assert.equal(restarted.azDoIntegrations[0].project, phase === 'before' ? 'original' : 'replacement')
    assert.equal(
      JSON.parse(await fs.readFile(file, 'utf8')).azDoIntegrations[0].project,
      restarted.azDoIntegrations[0].project
    )
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
      store.saveSettings({
        ...original,
        azDoIntegrations: [{ ...original.azDoIntegrations[0], project: 'replacement' }],
      }),
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
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).azDoIntegrations[0].project, 'replacement')
    assert.equal((await store.loadSettings()).azDoIntegrations[0].project, 'original')
    assert.equal((await settingsModule(directory).loadSettings()).azDoIntegrations[0].project, 'original')
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
  {
    ...original,
    azDoIntegrations: [{ ...original.azDoIntegrations[0], pat: Buffer.from('corrupt').toString('base64url') }],
  },
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
  const originalBytes = JSON.stringify({
    ...original,
    azDoIntegrations: [{ ...original.azDoIntegrations[0], project: 'new' }],
  })
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
  assert.equal((await store.loadSettings()).azDoIntegrations[0].project, 'original')
  assert.deepEqual(await fs.readdir(directory), ['settings.json'])
})
