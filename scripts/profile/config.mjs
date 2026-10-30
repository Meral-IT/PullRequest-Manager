import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const profileTemporaryRoot = realpathSync(tmpdir())

export function readProfileConfig(candidate) {
  const invalid = () => {
    throw new Error('Invalid packaged profile configuration')
  }
  if (typeof candidate !== 'string') invalid()
  const name = basename(dirname(candidate))
  const directory = join(profileTemporaryRoot, name)
  const configPath = join(directory, 'config.json')
  const userData = join(directory, 'user-data')
  const result = join(directory, 'result.json')
  const configFile = lstatSync(configPath, { throwIfNoEntry: false })
  if (
    !/^prm-profile-[A-Za-z0-9]{6}$/.test(name) ||
    candidate !== configPath ||
    !lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() ||
    !configFile?.isFile() ||
    configFile.size > 4096 ||
    !lstatSync(userData, { throwIfNoEntry: false })?.isDirectory() ||
    !lstatSync(join(userData, 'settings.json'), { throwIfNoEntry: false })?.isFile()
  )
    invalid()
  const resultFile = lstatSync(result, { throwIfNoEntry: false })
  if (resultFile && !resultFile.isFile()) invalid()
  if (
    readdirSync(directory).some((entry) => !['config.json', 'user-data', 'result.json'].includes(entry)) ||
    readdirSync(userData).some((entry) => entry !== 'settings.json')
  )
    invalid()
  let config
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    invalid()
  }
  if (
    !config ||
    ![0, 32, 1000, 10000].includes(config.count) ||
    ![1, 2].includes(config.run) ||
    config.cycles !== 3 ||
    !Number.isSafeInteger(config.launchedAtMs) ||
    config.launchedAtMs < 0 ||
    config.userData !== userData ||
    config.result !== result
  )
    invalid()
  return { count: config.count, run: config.run, cycles: 3, userData, result, launchedAtMs: config.launchedAtMs }
}
