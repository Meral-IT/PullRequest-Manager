import { PrProfile } from './pr-profile'

export interface AzDoSettings {
  organizationUrl: string
  project: string
  pat: string
  updateInterval: number
  intelligentApproval: boolean
  acknowledgedScopeRequirements?: string
}

export interface AzDoIntegration extends AzDoSettings {
  id: string
  name: string
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark'
  tableSize: TableSize
}

export enum TableSize {
  ExtraSmall = 'extra-small',
  Small = 'small',
  Medium = 'medium',
}

export interface GeneralSettings {
  openAtLogin: boolean
  enableNotifications: boolean
  notificationSound: boolean
  repositoriesRootDirectory: string
}

export interface SettingsModel {
  general: GeneralSettings
  appearance: AppearanceSettings
  azDoIntegrations: AzDoIntegration[]
  profiles: PrProfile[]
}
