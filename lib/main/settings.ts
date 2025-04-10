import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { SettingsModel, TableSize } from '../models/settings.model'
import Logger from 'electron-log/main'
import { defaultProfiles } from '../models/pr-profile'

const settingFile = path.join(app.getPath('userData'), 'settings.json')
const defaultSettings: SettingsModel = {
  azDo: {
    organizationUrl: '',
    project: '',
    pat: '',
    updateInterval: 60,
  },
  appearance: {
    theme: 'system',
    tableSize: TableSize.Small,
  },
  profiles: defaultProfiles,
}
let cachedSettings: SettingsModel | null = null

function decryptString(bufferString: string): string {
  return bufferString ? safeStorage.decryptString(Buffer.from(bufferString, 'base64url')) : ''
}

function encryptString(input: string): string {
  return input ? safeStorage.encryptString(input).toString('base64url') : ''
}

export async function saveSettings(input: SettingsModel): Promise<SettingsModel> {
  const originalPat = input.azDo.pat
  const pat = encryptString(input.azDo.pat)

  input.azDo.pat = pat
  await fs.writeFile(settingFile, JSON.stringify(input, null, 2))

  input.azDo.pat = originalPat

  cachedSettings = normalizeSettings(input)
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
  return cachedSettings
}

function normalizeSettings(input: SettingsModel): SettingsModel {
  return {
    azDo: {
      organizationUrl: input.azDo.organizationUrl || defaultSettings.azDo.organizationUrl,
      project: input.azDo.project || defaultSettings.azDo.project,
      pat: input.azDo.pat || defaultSettings.azDo.pat,
      updateInterval: input.azDo.updateInterval || defaultSettings.azDo.updateInterval,
    },
    appearance: {
      theme: input.appearance.theme || defaultSettings.appearance,
      tableSize: input.appearance.tableSize || defaultSettings.appearance.tableSize,
    },
    profiles: input.profiles || defaultSettings.profiles,
  }
}
