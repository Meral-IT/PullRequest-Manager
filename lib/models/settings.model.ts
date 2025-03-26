import { PrProfile } from './pr-profile'

export interface AzDoSettings {
  organizationUrl: string
  project: string
  pat: string
  updateInterval: number
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

export interface SettingsModel {
  appearance: AppearanceSettings
  azDo: AzDoSettings
  profiles: PrProfile[]
}
