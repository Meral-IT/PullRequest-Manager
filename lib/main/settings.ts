import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultProfiles } from '../models/pr-profile'
import { getProfileFilterErrors } from '../models/profile-filter.schema'
import { SettingsModel, TableSize } from '../models/settings.model'
import { AzureDevOpsConnection, sameAzureDevOpsConnection } from '../models/azure-devops-access'
import { updateTrayProfiles } from './tray'

const settingFile = path.join(app.getPath('userData'), 'settings.json')
const defaultSettings: SettingsModel = {
  general: {
    openAtLogin: false,
    enableNotifications: true,
    notificationSound: false,
    repositoriesRootDirectory: '',
  },
  azDo: {
    organizationUrl: '',
    project: '',
    pat: '',
    updateInterval: 180,
    intelligentApproval: true,
  },
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

export function saveSettings(input: SettingsModel): Promise<SettingsModel> {
  return enqueueSettingsWrite(() => writeSettings(input))
}

export async function acknowledgeAzureDevOpsRequirements(
  fingerprint: string,
  connection: AzureDevOpsConnection
): Promise<boolean> {
  await loadSettings()
  return enqueueSettingsWrite(async () => {
    const settings = cachedSettings!
    if (!sameAzureDevOpsConnection(settings.azDo, connection)) return false
    await writeSettings({ ...settings, azDo: { ...settings.azDo, acknowledgedScopeRequirements: fingerprint } })
    return true
  })
}

async function writeSettings(input: SettingsModel): Promise<SettingsModel> {
  for (const profile of input.profiles) {
    if (profile.filter === undefined) continue
    const errors = getProfileFilterErrors(profile.filter)
    if (errors.length) throw new Error(`Invalid filter for profile "${profile.label}": ${errors.join('; ')}`)
  }

  let acknowledgement = input.azDo.acknowledgedScopeRequirements
  if (cachedSettings) {
    if (sameAzureDevOpsConnection(input.azDo, cachedSettings.azDo)) {
      acknowledgement ??= cachedSettings.azDo.acknowledgedScopeRequirements
    } else {
      acknowledgement = undefined
    }
  }
  const settings = { ...input, azDo: { ...input.azDo, acknowledgedScopeRequirements: acknowledgement } }
  await fs.writeFile(
    settingFile,
    JSON.stringify(
      {
        ...settings,
        azDo: { ...settings.azDo, pat: encryptString(settings.azDo.pat) },
      },
      null,
      2
    )
  )

  cachedSettings = normalizeSettings(settings)

  app.setLoginItemSettings({
    openAtLogin: cachedSettings.general.openAtLogin,
  })

  updateTrayProfiles(cachedSettings.profiles)

  return cachedSettings
}

export async function loadSettings(): Promise<SettingsModel> {
  if (cachedSettings) {
    return cachedSettings
  }
  try {
    await fs.access(settingFile)
  } catch (error) {
    await saveSettings(defaultSettings)
  }

  const data = await fs.readFile(settingFile, 'utf-8')
  const loaded = JSON.parse(data)
  loaded.azDo.pat = loaded.azDo.pat ? decryptString(loaded.azDo.pat) : ''

  cachedSettings = normalizeSettings(loaded)
  cachedSettings.general.openAtLogin = app.getLoginItemSettings().openAtLogin
  return cachedSettings
}

function normalizeSettings(input: SettingsModel): SettingsModel {
  const settings = {
    general: {
      openAtLogin: input.general?.openAtLogin || defaultSettings.general.openAtLogin,
      enableNotifications: input.general?.enableNotifications ?? defaultSettings.general.enableNotifications,
      notificationSound: input.general?.notificationSound ?? defaultSettings.general.notificationSound,
      repositoriesRootDirectory:
        input.general?.repositoriesRootDirectory || defaultSettings.general.repositoriesRootDirectory,
    },
    azDo: {
      organizationUrl: input.azDo.organizationUrl || defaultSettings.azDo.organizationUrl,
      project: input.azDo.project || defaultSettings.azDo.project,
      pat: input.azDo.pat || defaultSettings.azDo.pat,
      updateInterval: input.azDo.updateInterval || defaultSettings.azDo.updateInterval,
      intelligentApproval: input.azDo.intelligentApproval ?? defaultSettings.azDo.intelligentApproval,
      acknowledgedScopeRequirements: input.azDo.acknowledgedScopeRequirements,
    },
    appearance: {
      theme: input.appearance.theme || defaultSettings.appearance.theme,
      tableSize: input.appearance.tableSize || defaultSettings.appearance.tableSize,
    },
    profiles: input.profiles || defaultSettings.profiles,
  }

  for (const profile of settings.profiles) {
    profile.visible ??= true
  }

  return settings
}
