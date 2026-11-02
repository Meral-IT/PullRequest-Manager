import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

export function loadSettingsUnload(dialog) {
  const result = { exports: {} }
  const compiled = ts.transpileModule(readFileSync('lib/window/settings-unload.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(compiled, {
    module: result,
    exports: result.exports,
    require: () => ({ dialog }),
  })
  return result.exports.registerSettingsUnloadProtection
}
