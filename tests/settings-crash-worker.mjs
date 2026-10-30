import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { validateSmokeProfilePath } from './smoke-profile-path.mjs'

const directory = validateSmokeProfilePath(process.argv[2])
const phase = process.argv[3]
if (!['before', 'after'].includes(phase)) throw new Error('Invalid crash-test phase')
const localRequire = createRequire(path.resolve('temp/tests/lib/main/settings.js'))
const compiled = ts.transpileModule(readFileSync('lib/main/settings.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const result = { exports: {} }
const pause = () => {
  process.send(phase)
  return new Promise(() => undefined)
}
runInNewContext(compiled, {
  module: result,
  exports: result.exports,
  Buffer,
  process,
  require: (name) => {
    if (name === 'node:fs/promises')
      return {
        ...fs,
        rename: async (...args) => {
          if (phase === 'before') await pause()
          await fs.rename(...args)
          if (phase === 'after') await pause()
        },
      }
    if (name === 'electron')
      return {
        app: {
          getPath: () => directory,
          getLoginItemSettings: () => ({ openAtLogin: false }),
          setLoginItemSettings: () => undefined,
        },
        safeStorage: { encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
      }
    if (name === './tray') return { updateTrayProfiles: () => undefined }
    return localRequire(name)
  },
})
try {
  const current = await result.exports.loadSettings()
  await result.exports.saveSettings({ ...current, azDo: { ...current.azDo, project: 'replacement' } })
  throw new Error('Crash-test phase was never reached')
} catch (error) {
  console.error(error)
  process.exit(1)
}
