import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import electron from 'electron'
import { withSmokeProfile } from './smoke-profile-path.mjs'

if (!process.versions.electron) {
  test('reload stays by default and discards only when Leave is chosen', () => {
    const result = withSmokeProfile((userData) =>
      spawnSync(electron, [`--user-data-dir=${userData}`, import.meta.filename], {
        stdio: 'inherit',
        timeout: 15_000,
      })
    )
    if (result.error) console.error(result.error)
    assert.equal(result.status ?? 1, 0, 'Electron unload decisions must pass')
  })
} else {
  try {
    const { registerSettingsUnloadProtection } = await import('../lib/window/settings-unload.ts')
    const originalDialog = electron.dialog.showMessageBoxSync
    let unload
    let response = 0
    electron.dialog.showMessageBoxSync = (_window, options) => {
      assert.equal(options.defaultId, 0, 'Stay is the default')
      assert.equal(options.cancelId, 0, 'Dismissal keeps the draft')
      return response
    }
    try {
      registerSettingsUnloadProtection({
        webContents: {
          on: (_event, handler) => {
            unload = handler
          },
        },
      })
      for (const [choice, expected] of [
        [0, false],
        [1, true],
      ]) {
        response = choice
        let discarded = false
        unload({
          preventDefault: () => {
            discarded = true
          },
        })
        assert.equal(discarded, expected, 'Only Leave permits Electron to unload the draft')
      }
    } finally {
      electron.dialog.showMessageBoxSync = originalDialog
    }
    electron.app.exit(0)
  } catch (error) {
    console.error(error)
    electron.app.exit(1)
  }
}
