import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultProfiles } from '../models/pr-profile'
import { getProfileFilterErrors } from '../models/profile-filter.schema'
import { SettingsModel, TableSize } from '../models/settings.model'
import { AzureDevOpsConnection, sameAzureDevOpsConnection } from '../models/azure-devops-access'
import { updateTrayProfiles } from './tray'

const settingFile = path.join(app.getPath('userData'), 'settings.json')
const stagedSettingFile = `${settingFile}.tmp`
const recoverySettingFile = `${settingFile}.rollback`
const defaultSettings: SettingsModel = {
  general: {
    openAtLogin: false,
    enableNotifications: true,
    notificationSound: false,
    repositoriesRootDirectory: '',
  },
  azDoIntegrations: [],
  appearance: {
    theme: 'system',
    tableSize: TableSize.Small,
  },
  profiles: defaultProfiles,
}
let cachedSettings: SettingsModel | null = null
let pendingSettingsWrite: Promise<unknown> = Promise.resolve()

function enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingSettingsWrite.then(operation)
  pendingSettingsWrite = result.catch(() => undefined)
  return result
}

function decryptString(bufferString: string): string {
  return bufferString ? safeStorage.decryptString(Buffer.from(bufferString, 'base64url')) : ''
}

function encryptString(input: string): string {
  return input ? safeStorage.encryptString(input).toString('base64url') : ''
}

function parseSettings(data: string): SettingsModel {
  const loaded = JSON.parse(data)
  if (!('azDoIntegrations' in loaded)) {
    // The previous settings form stored edited intervals as strings.
    const interval = Number(loaded.azDo?.updateInterval)
    loaded.azDoIntegrations = loaded.azDo
      ? [
          {
            ...loaded.azDo,
            id: randomUUID(),
            name: loaded.azDo.project || 'Azure DevOps',
            organizationUrl: loaded.azDo.organizationUrl || '',
            project: loaded.azDo.project || '',
            updateInterval: Number.isFinite(interval) && interval > 0 && interval <= 3000 ? interval : 180,
          },
        ]
      : []
  }
  for (const integration of loaded.azDoIntegrations) integration.pat = decryptString(integration.pat)
  return normalizeSettings(loaded)
}

async function syncSettingsDirectory(): Promise<void> {
  // Node cannot open directories for flushing on Windows; the staged file is still flushed there.
  if (process.platform === 'win32') return
  const directory = await fs.open(path.dirname(settingFile), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function recoverSettings(): Promise<void> {
  let recovery: Awaited<ReturnType<typeof fs.open>>
  try {
    recovery = await fs.open(recoverySettingFile, 'r+')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  try {
    // Recovery may follow an interrupted write or failed flush; validate and re-flush before replacing anything.
    parseSettings(await recovery.readFile('utf8'))
    await recovery.sync()
  } finally {
    await recovery.close()
  }
  await fs.rename(recoverySettingFile, settingFile)
  await syncSettingsDirectory()
}

async function replaceSettings(data: string): Promise<void> {
  await recoverSettings()
  let previous: Buffer | undefined
  try {
    previous = await fs.readFile(settingFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // The settings queue also owns this reserved sibling left by an interrupted save.
  await fs.rm(stagedSettingFile, { force: true })
  const options = { flag: 'wx', mode: 0o600, flush: true } as const
  let replaced = false
  try {
    await fs.writeFile(stagedSettingFile, data, options)
    await fs.rename(stagedSettingFile, settingFile)
    replaced = true
    await syncSettingsDirectory()
  } catch (error) {
    if (replaced) {
      try {
        if (previous !== undefined) {
          await fs.writeFile(recoverySettingFile, previous, options)
          await fs.rename(recoverySettingFile, settingFile)
        } else {
          await fs.rm(settingFile)
        }
        await syncSettingsDirectory()
      } catch (rollbackError) {
        // Retain a staged recovery copy if restoring the previous complete file also fails.
        throw new AggregateError(
          [error, rollbackError],
          `Settings rollback failed; recovery file: ${recoverySettingFile}`,
          { cause: rollbackError }
        )
      }
    }
    try {
      await fs.rm(stagedSettingFile, { force: true })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Settings save and staging cleanup failed', {
        cause: cleanupError,
      })
    }
    throw error
  }
}

export function saveSettings(input: SettingsModel): Promise<SettingsModel> {
  return enqueueSettingsWrite(() => writeSettings(input))
}

export async function acknowledgeAzureDevOpsRequirements(
  fingerprint: string,
  connection: AzureDevOpsConnection,
  integrationId: string
): Promise<boolean> {
  await loadSettings()
  return enqueueSettingsWrite(async () => {
    const settings = cachedSettings!
    const integration = settings.azDoIntegrations.find((item) => item.id === integrationId)
    if (!integration || !sameAzureDevOpsConnection(integration, connection)) return false
    await writeSettings({
      ...settings,
      azDoIntegrations: settings.azDoIntegrations.map((item) =>
        item.id === integrationId ? { ...item, acknowledgedScopeRequirements: fingerprint } : item
      ),
    })
    return true
  })
}

async function writeSettings(input: SettingsModel): Promise<SettingsModel> {
  const normalized = normalizeSettings(input)
  for (const profile of input.profiles) {
    if (profile.filter === undefined) continue
    const errors = getProfileFilterErrors(profile.filter)
    if (errors.length) throw new Error(`Invalid filter for profile "${profile.label}": ${errors.join('; ')}`)
  }

  const settings = {
    ...normalized,
    azDoIntegrations: normalized.azDoIntegrations.map((integration) => {
      const previous = cachedSettings?.azDoIntegrations.find((item) => item.id === integration.id)
      const acknowledgedScopeRequirements =
        previous && !sameAzureDevOpsConnection(integration, previous)
          ? undefined
          : (integration.acknowledgedScopeRequirements ?? previous?.acknowledgedScopeRequirements)
      return { ...integration, acknowledgedScopeRequirements }
    }),
  }
  await persistSettings(settings)

  cachedSettings = settings

  app.setLoginItemSettings({
    openAtLogin: cachedSettings.general.openAtLogin,
  })

  updateTrayProfiles(cachedSettings.profiles)

  return cachedSettings
}

async function persistSettings(settings: SettingsModel): Promise<void> {
  await replaceSettings(
    JSON.stringify(
      {
        ...settings,
        azDoIntegrations: settings.azDoIntegrations.map((integration) => ({
          ...integration,
          pat: encryptString(integration.pat),
        })),
      },
      null,
      2
    )
  )
}

export async function loadSettings(): Promise<SettingsModel> {
  if (cachedSettings) {
    return cachedSettings
  }
  return enqueueSettingsWrite(async () => {
    if (cachedSettings) return cachedSettings
    await fs.rm(stagedSettingFile, { force: true })
    await recoverSettings()
    let data: string
    try {
      data = await fs.readFile(settingFile, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return writeSettings(defaultSettings)
      throw error
    }
    const settings = parseSettings(data)
    settings.general.openAtLogin = app.getLoginItemSettings().openAtLogin
    // Migration preserves old invalid profile filters so Settings can still repair them.
    if (!('azDoIntegrations' in JSON.parse(data))) await persistSettings(settings)
    cachedSettings = settings
    return cachedSettings
  })
}

function normalizeSettings(input: SettingsModel): SettingsModel {
  if (!Array.isArray(input.azDoIntegrations)) throw new Error('Azure DevOps integrations must be a list.')
  const ids = new Set<string>()
  for (const integration of input.azDoIntegrations) {
    if (!integration || typeof integration.id !== 'string' || !integration.id || ids.has(integration.id))
      throw new Error('Azure DevOps integrations must have unique IDs.')
    ids.add(integration.id)
    for (const field of ['name', 'organizationUrl', 'project', 'pat'] as const)
      if (typeof integration[field] !== 'string') throw new Error(`Invalid integration ${field}.`)
    if (integration.intelligentApproval !== undefined && typeof integration.intelligentApproval !== 'boolean')
      throw new Error('Invalid integration smart approval setting.')
    if (
      integration.updateInterval !== undefined &&
      (!Number.isFinite(integration.updateInterval) ||
        integration.updateInterval <= 0 ||
        integration.updateInterval > 3000)
    )
      throw new Error('Integration refresh interval must be greater than 0 and at most 3000 seconds.')
  }
  const settings = {
    general: {
      openAtLogin: input.general?.openAtLogin || defaultSettings.general.openAtLogin,
      enableNotifications: input.general?.enableNotifications ?? defaultSettings.general.enableNotifications,
      notificationSound: input.general?.notificationSound ?? defaultSettings.general.notificationSound,
      repositoriesRootDirectory:
        input.general?.repositoriesRootDirectory || defaultSettings.general.repositoriesRootDirectory,
    },
    azDoIntegrations: input.azDoIntegrations.map((integration) => ({
      ...integration,
      updateInterval: integration.updateInterval ?? 180,
      intelligentApproval: integration.intelligentApproval ?? true,
    })),
    appearance: {
      theme: input.appearance.theme || defaultSettings.appearance.theme,
      tableSize: input.appearance.tableSize || defaultSettings.appearance.tableSize,
    },
    profiles: (input.profiles || defaultSettings.profiles).map((profile) => ({
      ...profile,
      visible: profile.visible ?? true,
    })),
  }

  return settings
}
