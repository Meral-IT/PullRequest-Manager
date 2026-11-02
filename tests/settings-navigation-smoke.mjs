import assert from 'node:assert/strict'
import electron from 'electron'
import { loadSettingsUnload } from './settings-unload-fixture.mjs'

export async function checkSettingsNavigation(window, settings, waitForRenderer, settleLayout) {
  const original = structuredClone(settings)
  const run = (code) => window.webContents.executeJavaScript(code)
  const click = (text) =>
    run(`Array.from(document.querySelectorAll('button, [role="menuitem"]'))
    .find(button => button.innerText.split('\\n')[0] === ${JSON.stringify(text)}).click()`)
  const integration = () => waitForRenderer(window, '!!document.querySelector(\'input[name="integrationName"]\')')
  const edit = (value, name = 'integrationName') =>
    run(`(() => {
    const input = document.querySelector('input[name="${name}"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const name = () => run('document.querySelector(\'input[name="integrationName"]\').value')
  const status = (text) =>
    waitForRenderer(
      window,
      `Array.from(document.querySelectorAll('[role=status]')).some(node => node.textContent === ${JSON.stringify(text)})`
    )
  const dialog = () => waitForRenderer(window, '!!document.querySelector(\'[role="dialog"]\')')
  const home = () => waitForRenderer(window, "!!document.querySelector('.zerodata')")
  const enter = async () => {
    window.webContents.send('navigate', { path: '/settings/integrations/smoke' })
    await integration()
    await settleLayout(window)
  }
  let saveMode = 'normal'
  let finishSave
  let saveCount = 0
  electron.ipcMain.handle('save-settings', async (_event, model) => {
    saveCount++
    if (saveMode === 'failure') throw new Error('Synthetic save failure')
    if (saveMode === 'deferred')
      await new Promise((resolve) => {
        finishSave = resolve
      })
    Object.assign(settings, model)
    window.webContents.send('settings', settings)
  })
  let unloadResponse = 0
  let unloadPrompts = 0
  loadSettingsUnload({
    showMessageBoxSync: () => {
      unloadPrompts++
      return unloadResponse
    },
  })(window)
  try {
    await enter()
    await status('Saved')
    await edit('Unsaved name')
    await status('Unsaved changes')
    await click('Appearance')
    await waitForRenderer(window, "document.body.innerText.includes('Theme')")
    await enter()
    assert.equal(await name(), 'Unsaved name', 'Settings subsection navigation keeps the draft')
    await click('File')
    await waitForRenderer(window, '!!document.querySelector(\'[role="menuitem"]\')')
    await click('Pull-Requests')
    await settleLayout(window)
    assert.equal(
      await run('!!document.querySelector(\'[role="dialog"]\')'),
      true,
      'File > Pull-Requests must ask before discarding a settings draft'
    )
    await click('Stay')
    assert.equal(await name(), 'Unsaved name')
    await click('Home')
    await dialog()
    await click('Stay')
    window.webContents.send('navigate', { path: '/?source=ipc' })
    await dialog()
    await click('Leave')
    await home()
    assert.equal(
      await run('location.hash'),
      '#/?source=ipc',
      'Leave continues the originally requested IPC destination'
    )
    await enter()
    assert.equal(await name(), original.azDoIntegrations[0].name, 'Leave discards without saving')
    await edit('Back draft')
    await run('history.back()')
    await dialog()
    await click('Stay')
    assert.equal(await name(), 'Back draft', 'Browser Back Stay preserves the draft')
    await run('history.back()')
    await dialog()
    await click('Leave')
    await home()
    await enter()
    await edit('Failed draft')
    saveMode = 'failure'
    await click('Save Settings')
    await waitForRenderer(
      window,
      "document.querySelector('[role=alert]')?.textContent.includes('Synthetic save failure')"
    )
    await status('Unable to save settings. Unsaved changes.')
    await click('Home')
    await dialog()
    await click('Stay')
    assert.equal(await name(), 'Failed draft', 'Failed save remains guarded')
    saveMode = 'normal'
    await click('Save Settings')
    await waitForRenderer(
      window,
      "!document.querySelector('[role=alert]') && Array.from(document.querySelectorAll('button')).some(b => b.innerText === 'Save Settings')"
    )
    await status('Saved')
    await click('Home')
    await home()
    await enter()
    assert.equal(await name(), 'Failed draft', 'Successful save becomes the clean snapshot')
    await edit('Submitted draft')
    await status('Unsaved changes')
    saveMode = 'deferred'
    await click('Save Settings')
    await status('Saving settings')
    await click('Saving settings')
    assert.equal(saveCount, 3, 'Disabled save button cannot start a second pending save')
    await edit('Later draft')
    finishSave()
    await waitForRenderer(window, "!document.body.innerText.includes('Saving settings')")
    assert.equal(await name(), 'Later draft', 'Save completion preserves edits made while saving')
    await status('Unsaved changes')
    await edit('synthetic-unsaved-PAT', 'azDoPat')
    await click('Home')
    await dialog()
    await click('Stay')
    assert.equal(await run("JSON.stringify([localStorage, sessionStorage]).includes('synthetic-unsaved-PAT')"), false)
    const stayed = new Promise((resolve) => window.webContents.once('will-prevent-unload', resolve))
    window.webContents.reload()
    await stayed
    await settleLayout(window)
    assert.equal(unloadPrompts, 1, 'Reload asks through the native Electron unload handler')
    assert.equal(await name(), 'Later draft', 'Reload Stay leaves the draft mounted')
    assert.equal(await run('document.querySelector(\'input[name="azDoPat"]\').value'), 'synthetic-unsaved-PAT')
    window.hide()
    window.show()
    assert.equal(await name(), 'Later draft', 'Hide and reopen retains the mounted draft')
    unloadResponse = 1
    const reloaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
    window.webContents.reloadIgnoringCache()
    await reloaded
    await integration()
    assert.equal(unloadPrompts, 2, 'Force reload also asks before discarding')
    assert.equal(await name(), 'Submitted draft', 'Reload Leave loads only the saved snapshot')
    assert.equal(await run('document.querySelector(\'input[name="azDoPat"]\').value'), '')
    assert.equal(saveCount, 3, 'Navigation, hide, and reload never save credentials automatically')
    await click('Home')
    await home()
  } finally {
    electron.ipcMain.removeHandler('save-settings')
    window.webContents.removeAllListeners('will-prevent-unload')
    Object.assign(settings, original)
    window.webContents.send('settings', settings)
  }
}
