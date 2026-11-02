import { PrProfile } from '@/lib/models/pr-profile'
import { Integration, IntegrationType, TableSize } from '@/lib/models/settings.model'
import type { GitHubAccess, GitHubValidationResult } from '@/lib/models/github-access'
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
  integrations: Integration[]
  profiles: SettingStatePrProfile[]
}

export interface SettingPageProps {
  state: SettingStateProps
  actions: {
    getInitialSettings: () => Promise<SettingStateProps>
    onChangeHandler: any
    validateAzDo: () => Promise<void>
    validateGitHub: () => Promise<void>
    addIntegration: (type?: IntegrationType) => string
    deleteIntegration: (id: string) => void
    selectIntegration: (id: string) => void
    updateIntegration: (id: string, changes: Partial<Integration>) => void
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
  validatingGitHub: boolean
  githubAccess?: GitHubAccess
  githubValidation?: GitHubValidationResult
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
    integrations: [],
    profiles: [],
  },
  actions: {
    getInitialSettings: () => Promise.resolve({} as SettingStateProps),
    onChangeHandler: () => {},
    validateAzDo: async () => {},
    validateGitHub: async () => {},
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
  validatingGitHub: false,
})
