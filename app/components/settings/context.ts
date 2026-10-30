import { PrProfile } from '@/lib/models/pr-profile'
import { AzDoIntegration, TableSize } from '@/lib/models/settings.model'
import { createContext } from 'react'
import type { AzureDevOpsAccess, AzureDevOpsValidationResult } from '@/lib/models/azure-devops-access'

export interface SettingStatePrProfile {
  id: string
  label: string
  isDefault?: boolean
  notifyOnNewPrs: boolean
  enableAcceptAll: boolean
  visible: boolean
  filter?: string
  filterValid: boolean
  sorting?: PrProfile['sorting']
  filterValidationMessage: string
}

export interface SettingStateProps {
  openAtLogin: boolean
  enableNotifications: boolean
  notificationSound: boolean
  repositoriesRootDirectory: string
  name: string
  email: string
  appearanceTheme: 'system' | 'light' | 'dark'
  appearanceTableSize: TableSize
  azDoIntegrations: AzDoIntegration[]
  profiles: SettingStatePrProfile[]
}

export interface SettingPageProps {
  state: SettingStateProps
  actions: {
    getInitialSettings: () => Promise<SettingStateProps>
    onChangeHandler: any
    validateAzDo: () => Promise<void>
    addIntegration: () => string
    deleteIntegration: (id: string) => void
    selectIntegration: (id: string) => void
    updateIntegration: (id: string, changes: Partial<AzDoIntegration>) => void
    saveSettings: any
    deleteProfile: (id: string) => void
    addProfile: () => void
    duplicateProfile: (id: string) => void
  }
  selectedIntegrationId: string
  saving: boolean
  saveError: string
  validatingAzDo: boolean
  azDoAccess?: AzureDevOpsAccess
  azDoValidation?: AzureDevOpsValidationResult
}

export const SettingsContext = createContext<SettingPageProps>({
  state: {
    openAtLogin: false,
    enableNotifications: true,
    notificationSound: false,
    repositoriesRootDirectory: '',
    appearanceTheme: 'system',
    appearanceTableSize: TableSize.Small,
    name: '',
    email: '',
    azDoIntegrations: [],
    profiles: [],
  },
  actions: {
    getInitialSettings: () => Promise.resolve({} as SettingStateProps),
    onChangeHandler: () => {},
    validateAzDo: async () => {},
    addIntegration: () => '',
    deleteIntegration: () => {},
    selectIntegration: () => {},
    updateIntegration: () => {},
    saveSettings: () => {},
    deleteProfile: () => {},
    addProfile: () => {},
    duplicateProfile: () => {},
  },
  selectedIntegrationId: '',
  saving: false,
  saveError: '',
  validatingAzDo: false,
})
