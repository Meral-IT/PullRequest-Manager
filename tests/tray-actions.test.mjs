import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

async function trayActions(service) {
  const notifications = []
  const image = {
    resize() {
      return this
    },
    setTemplateImage() {
      return undefined
    },
  }
  class Menu {
    constructor(items = []) {
      this.items = items.map((item) => ({
        ...item,
        submenu: Array.isArray(item.submenu) ? new Menu(item.submenu) : item.submenu,
      }))
    }
    static buildFromTemplate(items) {
      return new Menu(items)
    }
    getMenuItemById(id) {
      return this.items.find((item) => item.id === id)
    }
    append(item) {
      this.items.push(item)
    }
  }
  const trays = []
  const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
  const runtime = { exports: {} }
  const modules = new Map()
  const load = (filename) => {
    if (modules.has(filename)) return modules.get(filename).exports
    const result = filename === 'lib/main/tray.ts' ? runtime : { exports: {} }
    modules.set(filename, result)
    runInNewContext(
      ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
      }).outputText,
      {
        module: result,
        exports: result.exports,
        process: { platform: 'darwin' },
        require(name) {
          if (name.startsWith('@/resources/')) return 'image.png'
          if (name === 'electron')
            return {
              app: {},
              BrowserWindow: {},
              Menu,
              MenuItem: class {
                constructor(options) {
                  Object.assign(this, options)
                }
              },
              nativeImage: { createFromPath: () => image },
              nativeTheme: theme,
              Tray: class extends EventEmitter {
                constructor() {
                  super()
                  trays.push(this)
                }
                setContextMenu(menu) {
                  this.menu = menu
                }
                setToolTip() {
                  return undefined
                }
              },
              Notification: class {
                constructor(options) {
                  this.options = options
                }
                show() {
                  notifications.push(this.options)
                }
              },
            }
          if (name === 'electron-log/main')
            return {
              default: {
                error() {
                  return undefined
                },
              },
            }
          if (name === '../azure-devops/azure-devops-integrations.service')
            return { AzureDevOpsIntegrationsService: { getInstance: () => service } }
          if (name === '../tools/loading.service')
            return { default: { loadingEvent: new EventEmitter(), isLoading: false } }
          if (name === './app') return { default: () => ({}) }
          if (name === './settings')
            return { loadSettings: async () => ({ profiles: [{ label: 'Review queue', enableAcceptAll: true }] }) }
          if (name === './trayManager') return { TrayManager: class {} }
          if (name === '../models/azure-devops-access') return load('lib/models/azure-devops-access.ts')
          if (name === '../models/pull-request-action') return load('lib/models/pull-request-action.ts')
          throw new Error(`Unexpected tray dependency: ${name}`)
        },
      }
    )
    return result.exports
  }
  load('lib/main/tray.ts')
  await runtime.exports.default({})
  return { notifications, theme, tray: trays[0], api: runtime.exports }
}

test('tray approval disables all profile votes while pending and reports a safe partial outcome', async () => {
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  let calls = 0
  const state = await trayActions({
    approvePullRequestsForProfile: () => {
      calls++
      return pending
    },
  })
  const profileItem = () => state.tray.menu.getMenuItemById('approve').submenu.items[0]
  const item = profileItem()
  const voting = item.click()
  item.click()
  assert.equal(calls, 1, 'A tray double click must not cast duplicate votes')
  assert.equal(state.tray.menu.getMenuItemById('approve').enabled, false)
  state.api.updateTrayProfiles([{ label: 'Updated queue', enableAcceptAll: true }])
  assert.equal(profileItem().enabled, false, 'Menu rebuilds must preserve the pending guard')
  release({
    succeeded: 1,
    skipped: 2,
    failed: 1,
    error: 'Access denied. Check PAT scopes and Azure DevOps permissions for this feature.',
  })
  await voting
  assert.equal(state.tray.menu.getMenuItemById('approve').enabled, true)
  assert.match(state.notifications[0].body, /1 approved.*2 skipped.*1 failed/)
  assert.match(state.notifications[0].body, /Access denied/)
})

test('tray transport failures report safe copy and re-enable approval', async () => {
  const state = await trayActions({
    approvePullRequestsForProfile: async () => {
      throw new Error('PAT=test-token secret')
    },
  })
  await state.tray.menu.getMenuItemById('approve').submenu.items[0].click()
  assert.equal(state.tray.menu.getMenuItemById('approve').enabled, true)
  assert.equal(state.notifications.length, 1)
  assert.equal(JSON.stringify(state.notifications).includes('test-token'), false)
})
