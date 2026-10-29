import electron from 'electron'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const userData = process.versions.electron ? process.argv[2] : mkdtempSync(resolve(tmpdir(), 'pr-manager-smoke-'))
if (!process.versions.electron) {
  let result
  try {
    result = spawnSync(electron, [import.meta.filename, userData], { stdio: 'inherit', timeout: 45_000 })
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
}, 35_000)

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

async function settleLayout(window) {
  await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))
  })()`)
}

async function selectProfileTab(window, tab) {
  await window.webContents.executeJavaScript(`document.getElementById('profile-${tab}-tab').click()`)
  await waitForRenderer(window, `!document.getElementById('profile-${tab}-panel').hidden`)
  await settleLayout(window)
}

async function checkProfileLayout(window, singleRow = true) {
  await settleLayout(window)
  const layout = await window.webContents.executeJavaScript(`(() => {
    const rect = element => {
      const { top, bottom, height } = element.getBoundingClientRect()
      return { top, bottom, height, clientHeight: element.clientHeight }
    }
    const button = text => Array.from(document.querySelectorAll('button')).find(button => button.innerText === text)
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    const general = panel.id === 'profile-general-panel'
    const tab = document.getElementById(panel.getAttribute('aria-labelledby'))
    const save = rect(button('Save Settings') ?? button('Invalid Profile(s)'))
    const result = {
      general,
      panel: rect(panel),
      save,
      selected: tab.getAttribute('aria-selected') === 'true',
      otherHidden: getComputedStyle(document.getElementById(general ? 'profile-filter-panel' : 'profile-general-panel')).display === 'none',
      viewport: innerHeight,
      minimumEditorHeight: matchMedia('(max-height: 550px)').matches ? 80 : 180,
      overflow: panel.scrollWidth > panel.clientWidth || document.querySelector('.window-content').scrollWidth > document.querySelector('.window-content').clientWidth,
    }
    if (general) {
      const selects = Array.from(panel.querySelectorAll('select'))
      const luminance = color => {
        const rgb = color.match(/[\\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
          .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const foreground = luminance(getComputedStyle(button('Delete profile')).color)
      const background = luminance(getComputedStyle(document.querySelector('.fui-FluentProvider')).backgroundColor)
      return {
        ...result,
        sorts: selects.map(rect),
        labels: selects.map(select => rect(select.labels[0])),
        checkboxes: Array.from(panel.querySelectorAll('.fui-Checkbox')).map(rect),
        hintLinked: selects.every(select => document.getElementById(select.getAttribute('aria-describedby'))?.textContent.includes('column headers')),
        dangerContrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      }
    }
    return {
      ...result,
      toolbar: [button('Copy filter'), button('Paste filter')].map(rect),
      editor: rect(panel.querySelector('.monaco-editor').parentElement),
      editorViewport: rect(panel.querySelector('.monaco-editor')),
      field: rect(panel.querySelector('.fui-Field')),
    }
  })()`)
  assert.equal(layout.selected, true)
  assert.equal(layout.otherHidden, true)
  assert.ok(layout.panel.bottom <= layout.save.top, JSON.stringify(layout))
  assert.ok(layout.save.top >= 0 && layout.save.bottom <= layout.viewport, JSON.stringify(layout))
  assert.equal(layout.overflow, false, JSON.stringify(layout))
  if (layout.general) {
    assert.equal(layout.sorts.length, 2)
    assert.equal(layout.checkboxes.length, 3)
    if (singleRow) {
      for (const group of [layout.sorts, layout.labels, layout.checkboxes]) {
        assert.ok(
          group.every(({ top }) => Math.abs(top - group[0].top) <= 1),
          JSON.stringify(layout)
        )
      }
    }
    assert.equal(layout.sorts[0].height, layout.sorts[1].height)
    assert.equal(layout.hintLinked, true)
    assert.ok(layout.dangerContrast >= 4.5, `Delete contrast: ${layout.dangerContrast}`)
  } else {
    assert.ok(layout.editor.height >= layout.minimumEditorHeight, JSON.stringify(layout))
    assert.ok(Math.abs(layout.editorViewport.height - layout.editor.clientHeight) <= 1, JSON.stringify(layout))
    if (singleRow) {
      assert.ok(Math.abs(layout.toolbar[0].top - layout.toolbar[1].top) <= 1, JSON.stringify(layout))
      assert.ok(
        layout.editor.top >= layout.panel.top && layout.field.bottom <= layout.panel.bottom + 1,
        JSON.stringify(layout)
      )
    }
  }
}

async function capture(window, name) {
  if (!process.env.PR_MANAGER_SMOKE_SCREENSHOTS) return
  mkdirSync(process.env.PR_MANAGER_SMOKE_SCREENSHOTS, { recursive: true })
  writeFileSync(
    resolve(process.env.PR_MANAGER_SMOKE_SCREENSHOTS, `${name}.png`),
    (await window.webContents.capturePage()).toPNG()
  )
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
      width: 900,
      height: 670,
      frame: false,
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
    await checkProfileLayout(window)
    assert.deepEqual(
      await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('select')).map(select => ({ value: select.value, disabled: select.disabled }))
    `),
      [
        { value: 'creationDate', disabled: false },
        { value: 'descending', disabled: false },
      ]
    )
    for (const value of ['details', 'creationDate', '']) {
      await window.webContents.executeJavaScript(`(() => {
        const select = document.querySelector('select')
        select.value = ${JSON.stringify(value)}
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await waitForRenderer(window, `document.querySelectorAll('select')[1].disabled === ${!value}`)
      await checkProfileLayout(window)
    }
    await capture(window, 'profile-general')
    await selectProfileTab(window, 'filter')
    await checkProfileLayout(window)
    const resizeLayouts = []
    for (const height of [670, 900, 450, 350, 670]) {
      window.setContentSize(900, height)
      await settleLayout(window)
      await checkProfileLayout(window)
      resizeLayouts.push(
        await window.webContents.executeJavaScript(`(() => {
        const rect = element => {
          const { top, bottom, height } = element.getBoundingClientRect()
          return { top, bottom, height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }
        }
        const buttons = Array.from(document.querySelectorAll('button'))
        return {
          viewport: innerHeight,
          frame: rect(document.querySelector('.window-frame')),
          content: rect(document.querySelector('.window-content')),
          editor: rect(document.querySelector('.monaco-editor').parentElement),
          editorViewport: rect(document.querySelector('.monaco-editor')),
          save: rect(buttons.find(button => button.innerText === 'Save Settings')),
        }
      })()`)
      )
      if (height === 350) await capture(window, 'profile-short')
    }
    assert.ok(resizeLayouts[2].editor.height < resizeLayouts[1].editor.height, JSON.stringify(resizeLayouts))
    assert.ok(
      Math.abs(resizeLayouts[4].editor.height - resizeLayouts[0].editor.height) <= 1,
      JSON.stringify(resizeLayouts)
    )
    assert.ok(resizeLayouts[3].editor.bottom <= resizeLayouts[3].save.top, JSON.stringify(resizeLayouts[3]))
    for (const layout of resizeLayouts) {
      assert.equal(layout.frame.height, layout.viewport, JSON.stringify(layout))
      assert.ok(layout.content.bottom <= layout.viewport, JSON.stringify(layout))
      assert.ok(layout.save.bottom <= layout.viewport, JSON.stringify(layout))
      assert.ok(Math.abs(layout.editorViewport.height - layout.editor.clientHeight) <= 1, JSON.stringify(layout))
    }
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
    await selectProfileTab(window, 'general')
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.getElementById('profile-filter-tab').innerText.includes('invalid')"
      ),
      true
    )
    await checkProfileLayout(window)
    await selectProfileTab(window, 'filter')
    await pasteFilter('{"op":"AND","filters":[{"reviewers":{"op":"OR","filters":[{"isApproved":false}]}}]}')
    await waitForRenderer(
      window,
      `
      document.body.innerText.includes('Filter is valid.') &&
      !document.querySelector('.squiggly-error') &&
      Array.from(document.querySelectorAll('button')).some(button => button.innerText === 'Save Settings' && !button.disabled)
    `
    )
    await checkProfileLayout(window)
    await selectProfileTab(window, 'general')
    await checkProfileLayout(window)
    await selectProfileTab(window, 'filter')
    await window.webContents.executeJavaScript(`
      navigator.clipboard.writeText = async text => { globalThis.smokeCopiedFilter = text }
      Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Copy filter').click()
    `)
    assert.equal(
      await window.webContents.executeJavaScript('globalThis.smokeCopiedFilter'),
      '{"op":"AND","filters":[{"reviewers":{"op":"OR","filters":[{"isApproved":false}]}}]}'
    )
    await capture(window, 'profile-light')

    const longName = 'A very long profile name for pull requests across several projects and repositories'
    settings.profiles[0].label = longName
    settings.appearance.theme = 'dark'
    const lightBackground = await window.webContents.executeJavaScript(
      "getComputedStyle(document.querySelector('.fui-FluentProvider')).backgroundColor"
    )
    window.webContents.send('settings', settings)
    window.webContents.send('theme-changed', 'dark')
    await waitForRenderer(window, `document.querySelector('input[name="label"]').value === ${JSON.stringify(longName)}`)
    await waitForRenderer(
      window,
      `getComputedStyle(document.querySelector('.fui-FluentProvider')).backgroundColor !== ${JSON.stringify(lightBackground)}`
    )
    await checkProfileLayout(window)
    await capture(window, 'profile-dark-long-name')

    window.webContents.setZoomFactor(2)
    await settleLayout(window)
    await checkProfileLayout(window, false)
    await capture(window, 'profile-zoom-filter')
    await selectProfileTab(window, 'general')
    await checkProfileLayout(window, false)
    await window.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Delete profile').scrollIntoView({ block: 'nearest' })"
    )
    await settleLayout(window)
    assert.equal(
      await window.webContents.executeJavaScript(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const deletion = buttons.find(button => button.innerText === 'Delete profile').getBoundingClientRect()
      const save = buttons.find(button => button.innerText === 'Save Settings').getBoundingClientRect()
      return deletion.bottom <= save.top && save.bottom <= innerHeight
    })()`),
      true
    )
    await capture(window, 'profile-zoom')
    window.webContents.setZoomFactor(1)

    settings.profiles[0].label = 'All'
    settings.appearance.theme = 'light'
    window.webContents.send('settings', settings)
    window.webContents.send('theme-changed', 'light')
    await window.webContents.executeJavaScript("location.hash = '#/settings/profiles/new'; void 0")
    await waitForRenderer(
      window,
      "!!document.querySelector('label') && document.body.innerText.includes('Duplicate a profile')"
    )
    await settleLayout(window)
    assert.equal(
      await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('select').getBoundingClientRect()
      const duplicate = Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Duplicate')
      const button = duplicate.getBoundingClientRect()
      return !duplicate.disabled && Math.abs(select.top - button.top) <= 1 && select.height === button.height
    })()`),
      true
    )
    await capture(window, 'profile-new')
    for (const [button, expected] of [
      ['Duplicate', 'All (copy)'],
      ['New empty profile', 'New profile'],
    ]) {
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.innerText === ${JSON.stringify(button)}).click()`
      )
      await waitForRenderer(window, `document.body.innerText.includes(${JSON.stringify(expected)})`)
    }
    window.webContents.send('settings', { ...settings, profiles: [] })
    await waitForRenderer(window, "document.querySelector('select').disabled")
    assert.equal(
      await window.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Duplicate').disabled"
      ),
      true
    )
    await capture(window, 'profile-empty')
    await window.webContents.executeJavaScript(
      "Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'New empty profile').click()"
    )
    await waitForRenderer(window, "!document.querySelector('select').disabled")
    assert.equal(
      await window.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Duplicate').disabled"
      ),
      false
    )

    window.webContents.send('settings', settings)
    for (const [page, label] of [
      ['general', 'Notifications'],
      ['appearance', 'Theme'],
      ['azure-devops', 'Organization URL'],
    ]) {
      await window.webContents.executeJavaScript(`location.hash = '#/settings/${page}'; void 0`)
      await waitForRenderer(window, `document.body.innerText.includes(${JSON.stringify(label)})`)
      await settleLayout(window)
      assert.equal(
        await window.webContents.executeJavaScript(`(() => {
        const save = Array.from(document.querySelectorAll('button')).find(button => button.innerText === 'Save Settings').getBoundingClientRect()
        const content = document.querySelector('.window-content')
        return save.top >= 0 && save.bottom <= innerHeight && content.scrollWidth <= content.clientWidth
      })()`),
        true,
        page
      )
    }
    assert.deepEqual(errors, [])
    window.destroy()
    console.log(
      'Electron smoke test passed: renderer, sandboxed IPC, profile layout, themes, zoom, creation, and filter validation'
    )
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    clearTimeout(timeout)
    app.exit(exitCode)
  }
})
