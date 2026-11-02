import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSettingsUnload } from './settings-unload-fixture.mjs'

test('reload stays by default and discards only when Leave is chosen', () => {
  let unload
  let response = 0
  let discarded = false
  const register = loadSettingsUnload({ showMessageBoxSync: () => response })
  register({
    webContents: {
      on: (_event, handler) => {
        unload = handler
      },
    },
  })
  unload({
    preventDefault: () => {
      discarded = true
    },
  })
  assert.equal(discarded, false, 'Stay preserves the mounted draft')
  response = 1
  unload({
    preventDefault: () => {
      discarded = true
    },
  })
  assert.equal(discarded, true, 'Leave allows Electron to complete the reload')
})
