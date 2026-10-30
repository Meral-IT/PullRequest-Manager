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

let pendingStep = 'app startup'
const timeout = setTimeout(() => {
  console.error(`Electron smoke test timed out: ${pendingStep}`)
  app.exit(1)
}, 35_000)

function waitForRenderer(window, condition, description = condition) {
  pendingStep = description
  return window.webContents.executeJavaScript(`new Promise((resolve) => {
    const ready = () => (${condition})
    if (ready()) return resolve()
    const check = () => {
      if (ready()) {
        observer.disconnect()
        document.removeEventListener('focusin', check)
        resolve()
      }
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    document.addEventListener('focusin', check)
  })`)
}

async function settleLayout(window) {
  pendingStep = 'layout animation frames'
  await window.webContents.executeJavaScript(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
  )
  pendingStep = 'layout animations'
  await window.webContents.executeJavaScript(`Promise.all(document.getAnimations()
      .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))`)
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

async function checkTitlebarLayout(window, platform, width) {
  window.setContentSize(width, 670)
  await settleLayout(window)
  assert.deepEqual(
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll(
      '.window-titlebar [aria-haspopup="menu"]')).map(button => button.innerText)`),
    ['File', 'Edit', 'View', 'Window', 'Credits'],
    'all application menus are visible without pressing Alt'
  )
  const layout = await window.webContents.executeJavaScript(`(() => {
    const rect = element => {
      const { left, right, top, bottom, height } = element.getBoundingClientRect()
      return { left, right, top, bottom, height }
    }
    const bar = document.querySelector('.window-titlebar')
    const title = bar.querySelector('.window-titlebar-title')
    const menu = bar.querySelector('nav')
    const controls = bar.querySelector('.window-titlebar-controls')
    return {
      bar: rect(bar), title: rect(title), menu: rect(menu),
      controls: controls && rect(controls),
      buttons: Array.from(bar.querySelectorAll('button')).map(rect),
      draggable: getComputedStyle(bar).webkitAppRegion,
      menuDraggable: getComputedStyle(menu).webkitAppRegion,
      controlsDraggable: controls && getComputedStyle(controls).webkitAppRegion,
      overflow: bar.scrollWidth > bar.clientWidth,
      titleIsButton: !!title.querySelector('button'),
      spinner: title.querySelector('.fui-Spinner') && rect(title.querySelector('.fui-Spinner')),
    }
  })()`)
  const detail = JSON.stringify({ platform, width, ...layout })
  assert.equal(layout.bar.height, width < 640 ? 72 : 40, detail)
  assert.equal(layout.overflow, false, detail)
  assert.equal(layout.titleIsButton, false)
  assert.equal(layout.draggable, 'drag')
  assert.equal(layout.menuDraggable, 'no-drag')
  if (platform === 'darwin') assert.ok(layout.title.left >= 96, detail)
  if (platform === 'win32') {
    assert.equal(layout.controlsDraggable, 'no-drag')
    assert.ok(layout.title.right <= layout.controls.left, detail)
  }
  for (const button of layout.buttons) {
    assert.ok(button.height > 0 && button.left >= 0 && button.right <= width, detail)
    assert.ok(button.top >= 0 && button.bottom <= layout.bar.bottom, detail)
  }
  if (width < 640) assert.ok(layout.menu.top >= layout.title.bottom, detail)
  else {
    assert.ok(layout.title.right <= layout.menu.left, detail)
    if (layout.controls) assert.ok(layout.menu.right <= layout.controls.left, detail)
  }
  if (layout.spinner) assert.ok(layout.spinner.right <= layout.title.right, detail)
}

async function clickElement(window, selector, text) {
  const { x, y } = await window.webContents.executeJavaScript(`(() => {
    const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find(element => element.textContent.trim().startsWith(${JSON.stringify(text)}))
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
  })()`)
  window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
}

function pressKey(window, keyCode) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  // Native buttons activate Enter on keypress, which Electron sends as a separate char event.
  if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
}

async function focusWindow(window) {
  app.focus({ steal: true })
  window.focus()
  pendingStep = 'smoke test window focus'
  await window.webContents.executeJavaScript(`new Promise(resolve => {
    if (document.hasFocus()) return resolve()
    window.addEventListener('focus', () => resolve(), { once: true })
  })`)
}

async function checkTitlebarMenus(window) {
  await focusWindow(window)
  await clickElement(window, '.window-titlebar button', 'File')
  await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')', 'File menu opens by mouse')
  pressKey(window, 'Escape')
  await waitForRenderer(window, '!document.querySelector(\'[role="menu"]\')')
  await waitForRenderer(window, 'document.activeElement.innerText === "File"', 'Escape returns focus to File')
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.innerText'), 'File')

  pressKey(window, 'Tab')
  await waitForRenderer(window, 'document.activeElement.innerText === "Edit"', 'Tab moves focus to Edit')
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.innerText'), 'Edit')
  pressKey(window, 'Enter')
  await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')', 'Edit menu opens by Enter')
  pressKey(window, 'Escape')
  await waitForRenderer(window, '!document.querySelector(\'[role="menu"]\')')
  await waitForRenderer(window, 'document.activeElement.innerText === "Edit"', 'Escape returns focus to Edit')
  pressKey(window, 'Space')
  await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')', 'Edit menu reopens by Space')
  await clickElement(window, '.window-content', '')
  await waitForRenderer(window, '!document.querySelector(\'[role="menu"]\')')
  pressKey(window, 'Alt')
  assert.equal(
    await window.webContents.executeJavaScript(
      'document.querySelectorAll(\'.window-titlebar [aria-haspopup="menu"]\').length'
    ),
    5
  )

  await clickElement(window, '.window-titlebar button', 'File')
  await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')')
  await clickElement(window, '[role="menuitem"]', 'Preferences')
  await waitForRenderer(
    window,
    'Array.from(document.querySelectorAll(\'[role="menuitem"]\')).some(item => item.textContent === "General")'
  )
  await clickElement(window, '[role="menuitem"]', 'General')
  await waitForRenderer(window, 'location.hash === "#/settings/general" && !document.querySelector(\'[role="menu"]\')')
  await clickElement(window, '.window-titlebar button', 'File')
  await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')')
  await clickElement(window, '[role="menuitem"]', 'Pull-Requests')
  await waitForRenderer(window, 'location.hash === "#/" && !document.querySelector(\'[role="menu"]\')')

  await clickElement(window, '.window-titlebar button', 'View')
  await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')')
  await clickElement(window, '[role="menuitem"]', 'Actual Size')
  await waitForRenderer(window, '!document.querySelector(\'[role="menu"]\')')
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
    let windowPlatform = process.platform
    let finishWindowInit
    const windowInitReady = new Promise((resolve) => {
      finishWindowInit = resolve
    })
    ipcMain.handle('init-window', async () => {
      await windowInitReady
      return {
        width: 900,
        height: 670,
        maximizable: false,
        minimizable: true,
        platform: windowPlatform,
      }
    })
    ipcMain.handle('smoke:echo', (_event, value) => value)
    const menuActions = []
    ipcMain.handle('web-actual-size', () => {
      menuActions.push('web-actual-size')
    })

    const errors = []
    const window = new BrowserWindow({
      width: 900,
      height: 670,
      frame: false,
      titleBarStyle: 'hiddenInset',
      maximizable: false,
      // Hidden windows can stop producing animation frames on Windows.
      show: true,
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
    await focusWindow(window)
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

    await checkTitlebarLayout(window, 'darwin', 900)
    finishWindowInit()
    async function checkPlatform(platform) {
      windowPlatform = platform
      await window.loadFile(resolve(import.meta.dirname, '../out/renderer/index.html'))
      await waitForRenderer(
        window,
        `document.querySelector('.window-titlebar').dataset.platform === ${JSON.stringify(platform)}`
      )
      await checkTitlebarLayout(window, platform, 900)
      await checkTitlebarLayout(window, platform, 640)
      await checkTitlebarLayout(window, platform, 480)
      await capture(window, `title-menu-${platform}-narrow`)
      window.webContents.send('loading', { isLoading: true })
      await waitForRenderer(window, '!!document.querySelector(".window-titlebar .fui-Spinner")')
      await window.webContents.executeJavaScript(
        `document.querySelector('.window-titlebar-title-text').textContent = 'A long application title '.repeat(20); void 0`
      )
      await checkTitlebarLayout(window, platform, 640)
      assert.equal(
        await window.webContents.executeJavaScript(`(() => {
        const title = document.querySelector('.window-titlebar-title-text')
        return title.scrollWidth > title.clientWidth && getComputedStyle(title).textOverflow === 'ellipsis'
      })()`),
        true,
        'long titles truncate without covering the menus or loading indicator'
      )
      await window.webContents.executeJavaScript(`(() => {
        const title = document.querySelector('.window-titlebar-title-text')
        title.textContent = title.title
      })()`)
      await checkTitlebarLayout(window, platform, 900)
      await capture(window, `title-menu-${platform}`)
      window.webContents.send('loading', { isLoading: false })
      await waitForRenderer(window, '!document.querySelector(".window-titlebar .fui-Spinner")')
    }
    await checkPlatform('darwin')
    await checkPlatform('win32')
    await checkPlatform(process.platform)
    await checkTitlebarLayout(window, windowPlatform, 480)
    await checkTitlebarMenus(window)
    assert.deepEqual(menuActions, ['web-actual-size'])
    await checkTitlebarLayout(window, windowPlatform, 900)

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
    await checkTitlebarLayout(window, windowPlatform, 900)
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
      'Electron smoke test passed: renderer, title menus, sandboxed IPC, profile layout, themes, zoom, creation, and filter validation'
    )
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    clearTimeout(timeout)
    app.exit(exitCode)
  }
})
