export interface AzDoSettings {
  organizationUrl: string
  project: string
  pat: string
  updateInterval: number
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark'
}

export interface SettingsModel {
  appearance: AppearanceSettings
  azDo: AzDoSettings
}
