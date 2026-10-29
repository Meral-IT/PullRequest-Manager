import electron from 'electron'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const userData = process.versions.electron ? process.argv[2] : mkdtempSync(resolve(tmpdir(), 'pr-manager-smoke-'))
if (!process.versions.electron) {
  let result
  try {
    result = spawnSync(electron, [import.meta.filename, userData], { stdio: 'inherit', timeout: 30_000 })
  } finally {
    // Chromium must exit before Windows releases its profile file locks.
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow, ipcMain } = electron
app.setPath('userData', userData)

const timeout = setTimeout(() => {
  console.error('Electron smoke test timed out')
  app.exit(1)
}, 20_000)

function waitForRenderer(window, condition) {
  return window.webContents.executeJavaScript(`new Promise((resolve) => {
    const ready = () => (${condition})
    if (ready()) return resolve()
    const observer = new MutationObserver(() => {
      if (ready()) { observer.disconnect(); resolve() }
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
  })`)
}

app.whenReady().then(async () => {
  let exitCode = 0
  try {
    const settings = {
      general: {
        openAtLogin: false,
        enableNotifications: false,
        notificationSound: false,
        repositoriesRootDirectory: '',
      },
      appearance: { theme: 'light', tableSize: 'small' },
      azDo: { organizationUrl: '', project: '', pat: '', updateInterval: 180, intelligentApproval: true },
      profiles: [{ id: 'builtin:all', label: 'All', isDefault: true, visible: true }],
    }
    ipcMain.handle('get-settings', () => settings)
    ipcMain.handle('get-theme', () => settings.appearance.theme)
    ipcMain.handle('get-pr-data', () => ({ items: [], error: null }))
    ipcMain.handle('check-vscode-installed', () => false)
    ipcMain.handle('init-window', () => ({
      width: 900,
      height: 670,
      maximizable: false,
      minimizable: true,
      platform: process.platform,
    }))
    ipcMain.handle('smoke:echo', (_event, value) => value)

    const errors = []
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: resolve(import.meta.dirname, '../out/preload/preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    window.webContents.on('preload-error', (_event, _preload, error) => errors.push(error.message))
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') errors.push(details.message)
    })
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true })
    )
    await window.loadFile(resolve(import.meta.dirname, '../out/renderer/index.html'))
    await waitForRenderer(window, "document.body.innerText.includes('Currently, no pull requests need your attention')")
    assert.equal(window.webContents.getLastWebPreferences().sandbox, true)
    assert.deepEqual(
      await window.webContents.executeJavaScript(`
      (async () => ({
        require: typeof require,
        process: typeof process,
        result: await globalThis.api.invoke('smoke:echo', 'sandboxed IPC works'),
      }))()
    `),
      { require: 'undefined', process: 'undefined', result: 'sandboxed IPC works' }
    )

    await window.webContents.executeJavaScript("location.hash = '#/settings/profiles/builtin:all'; void 0")
    await waitForRenderer(
      window,
      '!!document.querySelector(\'.monaco-editor [aria-label="Profile filter JSON editor"]\')'
    )
    const pasteFilter = (text) =>
      window.webContents.executeJavaScript(`
      navigator.clipboard.readText = async () => ${JSON.stringify(text)}
      Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Paste filter').click()
    `)
    await pasteFilter('{"op":"AND","filters":[{"isDraft":"false"}]}')
    await waitForRenderer(
      window,
      `
      document.body.innerText.includes('filter.filters[0].isDraft') &&
      !!document.querySelector('.squiggly-error') &&
      Array.from(document.querySelectorAll('button')).some(button => button.innerText === 'Invalid Profile(s)' && button.disabled)
    `
    )
    await pasteFilter('{"op":"AND","filters":[{"reviewers":{"op":"OR","filters":[{"isApproved":false}]}}]}')
    await waitForRenderer(
      window,
      `
      document.body.innerText.includes('Filter is valid.') &&
      !document.querySelector('.squiggly-error') &&
      Array.from(document.querySelectorAll('button')).some(button => button.innerText === 'Save Settings' && !button.disabled)
    `
    )
    assert.deepEqual(errors, [])
    window.destroy()
    console.log('Electron smoke test passed: renderer, sandboxed preload, IPC, and offline profile editor validation')
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    clearTimeout(timeout)
    app.exit(exitCode)
  }
})
