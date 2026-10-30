import fs from 'node:fs/promises'
import { createRequire, Module } from 'node:module'
import { validateSmokeProfilePath } from './smoke-profile-path.mjs'

const directory = validateSmokeProfilePath(process.argv[2])
const phase = process.argv[3]
if (!['before', 'after'].includes(phase)) throw new Error('Invalid crash-test phase')
const localRequire = createRequire(new URL('../temp/tests/lib/main/settings.js', import.meta.url))
const pause = () => {
  process.send(phase)
  return new Promise(() => undefined)
}
const rename = fs.rename
fs.rename = async (...args) => {
  if (phase === 'before') await pause()
  await rename(...args)
  if (phase === 'after') await pause()
}

const electron = new Module(localRequire.resolve('electron'))
electron.exports = {
  app: {
    getPath: () => directory,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: () => undefined,
  },
  safeStorage: { encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
}
localRequire.cache[electron.id] = electron
const tray = new Module(localRequire.resolve('./tray'))
tray.exports = { updateTrayProfiles: () => undefined }
localRequire.cache[tray.id] = tray

try {
  const settings = localRequire('./settings.js')
  const current = await settings.loadSettings()
  await settings.saveSettings({
    ...current,
    azDoIntegrations: [{ ...current.azDoIntegrations[0], project: 'replacement' }],
  })
  throw new Error('Crash-test phase was never reached')
} catch (error) {
  console.error(error)
  process.exit(1)
}
