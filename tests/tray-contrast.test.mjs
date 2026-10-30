import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import electron from 'electron'
import ts from 'typescript'

if (!process.versions.electron) {
  test('native tray and menu contrast survives theme, loading, and profile changes', () => {
    const userData = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'pr-manager-tray-')))
    let result
    try {
      result = spawnSync(electron, [`--user-data-dir=${userData}`, import.meta.filename], {
        stdio: 'inherit',
        timeout: 30_000,
      })
    } finally {
      fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    if (result.error) console.error(result.error)
    assert.equal(result.status ?? 1, 0, 'Electron tray subprocess must exit successfully')
  })
}

const root = path.resolve(import.meta.dirname, '..')

function loadTray(platform) {
  const theme = Object.assign(new EventEmitter(), {
    shouldUseDarkColors: false,
    shouldUseDarkColorsForSystemIntegratedUI: true,
  })
  const loadingEvent = new EventEmitter()
  const loader = { loadingEvent, isLoading: false }
  const intervals = new Map()
  const modules = new Map()
  const mainWindow = { isVisible: () => false }
  const trays = []

  class TestTray extends EventEmitter {
    constructor(image) {
      super()
      trays.push(this)
      this.image = image
    }
    setImage(image) {
      this.image = image
    }
    setContextMenu(menu) {
      this.menu = menu
    }
    setToolTip(text) {
      this.toolTip = text
    }
  }

  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports
    const module = { exports: {} }
    modules.set(filename, module)
    const requireModule = (specifier) => {
      if (specifier === 'electron') return { ...electron, nativeTheme: theme, Tray: TestTray }
      if (specifier === 'electron-log/main') return { default: { error: () => undefined } }
      if (specifier.startsWith('@/resources/'))
        return { default: path.join(root, specifier.slice(2).replace('?asset', '')) }
      if (specifier === '../tools/loading.service') return { default: loader }
      if (specifier === './settings') return { loadSettings: async () => ({ profiles: [] }) }
      if (specifier === './app') return { default: () => mainWindow, showWindow: () => mainWindow }
      if (specifier === '../azure-devops/azure-devops.service') return { AzureDevOpsService: {} }
      return load(path.resolve(path.dirname(filename), `${specifier}.ts`))
    }
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
    }).outputText
    vm.runInNewContext(
      source,
      {
        module,
        exports: module.exports,
        require: requireModule,
        Buffer,
        process: { platform },
        setInterval(callback) {
          const timer = {}
          intervals.set(timer, callback)
          return timer
        },
        clearInterval(timer) {
          intervals.delete(timer)
        },
      },
      { filename }
    )
    return module.exports
  }

  return {
    api: load(path.join(root, 'lib/main/tray.ts')),
    theme,
    intervals,
    mainWindow,
    setLoading(isLoading) {
      loader.isLoading = isLoading
      loadingEvent.emit('loading', { isLoading })
    },
    get tray() {
      return trays[0]
    },
    tick() {
      for (const callback of intervals.values()) callback()
    },
  }
}

function assertColor(image, color, message) {
  if (typeof image === 'string') image = electron.nativeImage.createFromPath(image)
  assert(!image.isEmpty(), message)
  const bitmap = image.toBitmap()
  let opaquePixels = 0
  for (let index = 0; index < bitmap.length; index += 4) {
    if (bitmap[index + 3] !== 255) continue
    opaquePixels++
    assert.equal(bitmap[index], color, message)
    assert.equal(bitmap[index + 1], color, message)
    assert.equal(bitmap[index + 2], color, message)
  }
  assert(opaquePixels > 0, message)
}

function assertMask(image, assetPath) {
  const original = electron.nativeImage.createFromPath(path.join(root, assetPath))
  assert.deepEqual(image.getScaleFactors(), original.getScaleFactors(), 'display scales are preserved')
  for (const scaleFactor of original.getScaleFactors()) {
    const bitmap = image.toBitmap({ scaleFactor })
    const originalBitmap = original.toBitmap({ scaleFactor })
    assert.equal(bitmap.length, originalBitmap.length, 'physical image dimensions are preserved')
    assert.deepEqual(
      bitmap.filter((_, index) => index % 4 === 3),
      originalBitmap.filter((_, index) => index % 4 === 3),
      'transparency and antialiasing are preserved'
    )
  }
}

async function checkContrast() {
  assert.equal(electron.app.getPath('userData'), electron.app.commandLine.getSwitchValue('user-data-dir'))
  const state = loadTray('win32')
  await state.api.default(state.mainWindow)
  const menuIds = ['toggle-window', 'update-data', 'settings']
  const assertMenu = (color) => {
    for (const id of menuIds) assertColor(state.tray.menu.getMenuItemById(id).icon, color, `${id} menu contrast`)
  }
  assertMenu(0)
  assertColor(state.tray.image, 255, 'tray follows Windows system theme independently of app menus')

  state.api.updateTrayProfiles([{ label: 'Review team', enableAcceptAll: true }])
  state.setLoading(true)
  assert.equal(state.tray.menu.getMenuItemById('update-data').enabled, false)
  const manager = state.api.getTrayManager()
  manager.setActiveState(true)

  state.theme.shouldUseDarkColors = true
  state.theme.shouldUseDarkColorsForSystemIntegratedUI = false
  state.theme.emit('updated')
  assertMenu(255)
  assert.equal(state.tray.menu.getMenuItemById('update-data').enabled, false)
  assert.equal(state.tray.menu.getMenuItemById('approve').submenu.items[0].label, 'Review team')
  assert.equal(state.intervals.size, 1, 'theme changes keep the loading animation running')
  assertMask(manager.idleImage, 'resources/tray/pull@3x.png')
  assertMask(manager.trayAnimationFrames[0], 'resources/tray/loader/frame_00@3x.png')
  state.tick()
  assertColor(state.tray.image, 0, 'loading frames follow the light system theme')

  state.setLoading(false)
  assert.equal(state.intervals.size, 0)
  assert.equal(state.tray.menu.getMenuItemById('update-data').enabled, true)
  assert.equal(state.tray.image, manager.activeImage, 'active PR indicator keeps its original color')
  manager.setActiveState(false)
  assertColor(state.tray.image, 0, 'idle tray icon follows the light system theme')

  state.theme.shouldUseDarkColors = false
  state.theme.shouldUseDarkColorsForSystemIntegratedUI = true
  state.theme.emit('updated')
  assertMenu(0)
  assertColor(state.tray.image, 255, 'idle tray icon responds to a live system theme change')

  if (process.platform === 'darwin') {
    const mac = loadTray('darwin')
    await mac.api.default(mac.mainWindow)
    assert(mac.tray.image.isTemplateImage(), 'macOS renders tray symbols as native templates')
    for (const id of menuIds) assert(mac.tray.menu.getMenuItemById(id).icon.isTemplateImage())
    mac.setLoading(true)
    mac.tick()
    assert(mac.tray.image.isTemplateImage(), 'macOS loading frames remain native templates')
    mac.setLoading(false)
    console.log('PASS: macOS native templates')
  }

  const linux = loadTray('linux')
  await linux.api.default(linux.mainWindow)
  assertColor(linux.tray.image, 0, 'Linux uses the native UI theme for tray contrast')
  linux.theme.shouldUseDarkColors = true
  linux.theme.emit('updated')
  assertColor(linux.tray.image, 255, 'Linux tray follows native theme changes')
  console.log('PASS: tray/menu contrast, live themes, loading, profiles, active indicator, display scales')
}

if (process.versions.electron) {
  electron.app
    .whenReady()
    .then(checkContrast)
    .then(() => electron.app.quit())
    .catch((error) => {
      console.error(error)
      electron.app.exit(1)
    })
}
