import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function fixture(nativeGuard = false) {
  const nativeUpdater = new EventEmitter()
  const app = Object.assign(new EventEmitter(), { isPackaged: true })
  const load = createRequire(import.meta.url)
  const nativeCalls = { installs: 0, quits: 0, fail: true }
  let manager
  app.quit = () => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
    }
    app.emit('before-quit', event)
    if (!event.prevented) nativeCalls.quits++
  }
  const base = { exports: {} }
  runInNewContext(readFileSync(load.resolve('electron-updater/out/BaseUpdater.js'), 'utf8'), {
    module: base,
    exports: base.exports,
    setImmediate,
    require: (name) => {
      if (name === 'electron') return { autoUpdater: nativeUpdater }
      if (name === './AppUpdater')
        return {
          AppUpdater: class extends EventEmitter {
            constructor() {
              super()
              this.app = app
              this._logger = {
                info() {
                  return undefined
                },
                warn() {
                  return undefined
                },
              }
            }
            dispatchError(error) {
              this.emit('error', error)
            }
          },
        }
      return load(name)
    },
  })
  class NsisUpdater extends base.exports.BaseUpdater {
    constructor() {
      super()
      this.downloadedUpdateHelper = { file: '/cached-update.exe', downloadedFileInfo: {} }
    }
    doInstall() {
      nativeCalls.installs++
      if (nativeCalls.fail) Promise.resolve().then(() => this.emit('error', new Error('Cannot launch installer')))
      return true
    }
  }
  const updater = nativeGuard ? new NsisUpdater() : new EventEmitter()
  const published = []
  const calls = { download: 0, install: 0 }
  let finishDownload
  updater.checkForUpdates = async () => undefined
  updater.downloadUpdate = () => {
    calls.download++
    return new Promise((resolve, reject) => {
      finishDownload = { resolve, reject }
    })
  }
  if (!nativeGuard)
    updater.quitAndInstall = () => {
      calls.install++
    }
  const compiled = ts.transpileModule(readFileSync('lib/main/update.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const result = { exports: {} }
  runInNewContext(compiled, {
    module: result,
    exports: result.exports,
    process: { platform: nativeGuard ? 'win32' : 'darwin' },
    require: (name) => {
      if (name === 'electron')
        return {
          app,
          autoUpdater: nativeUpdater,
          BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => published.push(args) } }] },
          Notification: class extends EventEmitter {
            show() {
              return undefined
            }
          },
        }
      if (name === 'electron-log/main') return { info: () => undefined, error: () => undefined }
      if (name === 'electron-updater')
        return {
          autoUpdater: updater,
          NsisUpdater: nativeGuard
            ? class extends NsisUpdater {
                constructor() {
                  super()
                  Object.assign(this, {
                    checkForUpdates: updater.checkForUpdates,
                    downloadUpdate: updater.downloadUpdate,
                  })
                  updater.active = this
                }
              }
            : NsisUpdater,
        }
      if (name === './app') return {}
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  manager = result.exports.PullRequestUpdateManager.getInstance()
  const info = { version: '2.0.0', files: [], releaseDate: '2026-10-30T10:00:00Z' }
  return {
    manager,
    updater,
    native: () => updater.active ?? updater,
    nativeUpdater,
    nativeCalls,
    published,
    calls,
    info,
    finish: () => finishDownload,
  }
}

test('download is deduplicated and waits for explicit installation after readiness', async () => {
  const f = fixture()
  await f.manager.checkForUpdates()
  f.updater.emit('update-available', f.info)
  assert.equal(f.manager.getState().status, 'available')
  assert.equal(f.updater.autoInstallOnAppQuit, false)
  const first = f.manager.downloadUpdate()
  const duplicate = f.manager.downloadUpdate()
  await Promise.resolve()
  assert.equal(f.calls.download, 1)
  assert.equal(f.manager.getState().status, 'downloading')
  f.updater.emit('update-downloaded', f.info)
  f.finish().resolve([])
  await Promise.all([first, duplicate])
  assert.equal(f.calls.install, 0)
  assert.equal(f.manager.getState().status, 'ready')
  f.manager.installUpdate()
  f.manager.installUpdate()
  assert.equal(f.calls.install, 1)
  assert.equal(f.manager.getState().status, 'installing')
  assert.ok(f.published.every(([channel]) => channel === 'update:state-changed'))
})

test('installing before download readiness is rejected without running the installer', () => {
  const f = fixture()
  assert.throws(() => f.manager.installUpdate(), /ready/i)
  assert.equal(f.calls.install, 0)
})

test('download failure is retryable and late progress cannot replace an error or ready state', async () => {
  const f = fixture()
  await f.manager.checkForUpdates()
  f.updater.emit('update-available', f.info)
  const download = f.manager.downloadUpdate()
  await Promise.resolve()
  f.finish().reject(new Error('offline'))
  await assert.rejects(download, /offline/)
  assert.equal(f.manager.getState().status, 'error')
  assert.equal(f.manager.getState().operation, 'download')
  f.updater.emit('download-progress', { percent: 50 })
  assert.equal(f.manager.getState().status, 'error')
  const retry = f.manager.downloadUpdate()
  await Promise.resolve()
  assert.equal(f.calls.download, 2)
  f.updater.emit('download-progress', { percent: 40, total: 100, transferred: 40, bytesPerSecond: 10 })
  assert.equal(f.manager.getState().progress.percent, 40)
  f.updater.emit('update-downloaded', f.info)
  f.updater.emit('download-progress', { percent: 80 })
  f.updater.emit('update-available', f.info)
  assert.equal(f.manager.getState().status, 'ready')
  f.finish().resolve([])
  await retry
})

test('asynchronous installation errors preserve the downloaded release for retry', async () => {
  const f = fixture()
  await f.manager.checkForUpdates()
  f.updater.emit('update-available', f.info)
  const download = f.manager.downloadUpdate()
  await Promise.resolve()
  f.updater.emit('update-downloaded', f.info)
  f.finish().resolve([])
  await download
  f.manager.installUpdate()
  f.updater.emit('error', new Error('installer failed'))
  assert.equal(f.manager.getState().status, 'error')
  assert.equal(f.manager.getState().operation, 'install')
  assert.equal(f.manager.getState().info.version, '2.0.0')
  f.manager.installUpdate()
  assert.equal(f.calls.download, 1)
  assert.equal(f.calls.install, 2)
})

test('background check errors do not become download errors and idle downloads are rejected', async () => {
  const f = fixture()
  await f.manager.checkForUpdates()
  f.updater.emit('error', new Error('check unavailable'))
  assert.equal(f.manager.getState().status, 'idle')
  await assert.rejects(f.manager.downloadUpdate(), /available/i)
  assert.equal(f.calls.download, 0)
})

test('installation preparation keeps the window recoverable until the native quit signal', async () => {
  const f = fixture()
  await f.manager.checkForUpdates()
  f.updater.emit('update-available', f.info)
  const download = f.manager.downloadUpdate()
  await Promise.resolve()
  f.updater.emit('update-downloaded', f.info)
  f.finish().resolve([])
  await download
  f.manager.installUpdate()
  assert.equal(f.manager.isQuittingForUpdate(), false)
  f.nativeUpdater.emit('before-quit-for-update')
  assert.equal(f.manager.isQuittingForUpdate(), true)
  f.updater.emit('error', new Error('native preparation failed'))
  assert.equal(f.manager.isQuittingForUpdate(), false)
})

test('native NSIS async launch failure cancels the queued quit and permits one explicit retry', async () => {
  const f = fixture(true)
  await f.manager.checkForUpdates()
  f.native().emit('update-available', f.info)
  const download = f.manager.downloadUpdate()
  await Promise.resolve()
  f.native().emit('update-downloaded', f.info)
  f.finish().resolve([])
  await download
  f.manager.installUpdate()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.manager.getState().status, 'error')
  assert.equal(f.nativeCalls.quits, 0, 'Failed native launch must not quit or hide the recovery window')
  f.nativeCalls.fail = false
  f.manager.installUpdate()
  f.manager.installUpdate()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.nativeCalls.installs, 2, 'Retry must actually launch the installer, once')
  assert.equal(f.nativeCalls.quits, 1)
})
