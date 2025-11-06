import { TableSize } from '@/lib/models/settings.model'
import { createContext } from 'react'

export interface SettingStatePrProfile {
  id: string
  label: string
  isDefault?: boolean
  enableAcceptAll: boolean
  visible: boolean
  filter?: string
  filterValid: boolean
}

export interface SettingStateProps {
  openAtLogin: boolean
  enableNotifications: boolean
  notificationSound: boolean
  notificationProfiles: string[]
  name: string
  email: string
  appearanceTheme: 'system' | 'light' | 'dark'
  appearanceTableSize: TableSize
  azDoOrganizationUrl: string
  azDoProject: string
  azDoPat: string
  azDoInterval: number
  azDoIntelligentApproval: boolean
  azDoValidationMessage: string
  azDoValidationState: 'none' | 'error' | 'success' | 'warning' | undefined
  profiles: SettingStatePrProfile[]
}

export interface SettingPageProps {
  state: SettingStateProps
  actions: {
    getInitialSettings: () => Promise<SettingStateProps>
    onChangeHandler: any
    validateAzDo: any
    saveSettings: any
    deleteProfile: (id: string) => void
    addProfile: () => void
    duplicateProfile: (id: string) => void
  }
  saving: boolean
  validatingAzDo: boolean
}

export const SettingsContext = createContext<SettingPageProps>({
  state: {
    openAtLogin: false,
    enableNotifications: true,
    notificationSound: false,
    notificationProfiles: [],
    appearanceTheme: 'system',
    appearanceTableSize: TableSize.Small,
    name: '',
    email: '',
    azDoOrganizationUrl: '',
    azDoProject: '',
    azDoPat: '',
    azDoIntelligentApproval: true,
    azDoInterval: 60,
    azDoValidationMessage: '',
    azDoValidationState: 'none',
    profiles: [],
  },
  actions: {
    getInitialSettings: () => Promise.resolve({} as SettingStateProps),
    onChangeHandler: () => { },
    validateAzDo: () => { },
    saveSettings: () => { },
    deleteProfile: (id: string) => { },
    addProfile: () => { },
    duplicateProfile: (id: string) => { },
  },
  saving: false,
  validatingAzDo: false,
})
