import { PrProfile } from './pr-profile'

export interface AzDoSettings {
  organizationUrl: string
  project: string
  pat: string
  updateInterval: number
  intelligentApproval: boolean
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
}

export interface SettingsModel {
  general: GeneralSettings
  appearance: AppearanceSettings
  azDo: AzDoSettings
  profiles: PrProfile[]
}
