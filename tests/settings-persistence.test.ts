import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { SettingsModel } from '../lib/models/settings.model'

test('invalid filter saves leave disk, input and cached settings unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pr-profile-settings-'))
  const file = path.join(directory, 'settings.json')
  const original = {
    general: { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
    azDo: { organizationUrl: '', project: '', pat: '', updateInterval: 180, intelligentApproval: true },
    appearance: { theme: 'system', tableSize: 'small' },
    profiles: [{ id: 'all', label: 'All', visible: true, enableAcceptAll: false, notifyOnNewPrs: false }],
  } as SettingsModel
  const source = readFileSync(path.join(process.cwd(), 'lib/main/settings.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const localRequire = createRequire(path.join(__dirname, '../lib/main/settings.js'))
  const settingsModule = {
    exports: {} as {
      saveSettings: (settings: SettingsModel) => Promise<SettingsModel>
      loadSettings: () => Promise<SettingsModel>
    },
  }
  runInNewContext(compiled, {
    module: settingsModule,
    exports: settingsModule.exports,
    Buffer,
    require: (specifier: string) => {
      if (specifier === 'electron') {
        return {
          app: {
            getPath: () => directory,
            getLoginItemSettings: () => ({ openAtLogin: false }),
            setLoginItemSettings: () => {},
          },
          safeStorage: {
            encryptString: (value: string) => Buffer.from(value),
            decryptString: (value: Buffer) => value.toString(),
          },
        }
      }
      if (specifier === './tray') return { updateTrayProfiles: () => {} }
      return localRequire(specifier)
    },
  })
  try {
    await writeFile(file, JSON.stringify(original))
    const cached = await settingsModule.exports.loadSettings()
    const before = await readFile(file, 'utf8')
    const invalid = structuredClone(original)
    invalid.azDo.pat = 'unchanged-secret'
    invalid.profiles[0].filter = { op: 'AND', filters: [{ isDraft: 'false' }] } as never
    await assert.rejects(settingsModule.exports.saveSettings(invalid), /filter.*isDraft/i)
    assert.equal(await readFile(file, 'utf8'), before)
    assert.equal(invalid.azDo.pat, 'unchanged-secret')
    assert.strictEqual(await settingsModule.exports.loadSettings(), cached)
    invalid.profiles[0].filter = { op: 'AND', filters: [] }
    await settingsModule.exports.saveSettings(invalid)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(saved.profiles[0].filter, { op: 'AND', filters: [] })
    assert.notEqual(saved.azDo.pat, 'unchanged-secret')
    assert.equal(invalid.azDo.pat, 'unchanged-secret')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
