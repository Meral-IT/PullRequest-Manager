import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('settings saves publish immediately and handle a failed background refresh', async () => {
  const handlers = new Map()
  const published = []
  const errors = []
  const settings = { general: {}, profiles: [], azDoIntegrations: [], appearance: { theme: 'light' } }
  const service = {
    setConfiguration: () => undefined,
    updateDataImmediately: () => Promise.reject(new Error('temporary outage')),
  }
  const localRequire = createRequire(import.meta.url)
  const compiled = ts.transpileModule(readFileSync('lib/window/ipcEvents.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const result = { exports: {} }
  runInNewContext(compiled, {
    module: result,
    exports: result.exports,
    require: (name) => {
      if (name === 'electron') return { ipcMain: { handle: (name, callback) => handlers.set(name, callback) } }
      if (name === 'electron-log/main') return { error: (...args) => errors.push(args) }
      if (name === '../main/settings') return { saveSettings: async () => settings }
      if (name === '../azure-devops/azure-devops-integrations.service')
        return { AzureDevOpsIntegrationsService: { getInstance: () => service } }
      if (name === '../main/notification.service')
        return { NotificationService: { getInstance: () => ({ setSettings: () => undefined }) } }
      if (name === '../models/azure-devops-access')
        return { getAzureDevOpsAccessFailure: () => ({ message: 'Outage' }) }
      if (name === '../main/update') return {}
      return localRequire(name)
    },
  })
  result.exports.registerWindowIPC({
    setMenuBarVisibility: () => undefined,
    webContents: { send: (channel) => published.push(channel) },
  })
  await handlers.get('save-settings')(null, settings)
  assert.deepEqual(published, ['theme-changed', 'settings'])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(errors.length, 1)
})
