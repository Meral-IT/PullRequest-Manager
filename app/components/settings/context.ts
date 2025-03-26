import { PrProfile } from '@/lib/models/pr-profile'
import { TableSize } from '@/lib/models/settings.model'
import { createContext } from 'react'

export interface SettingStateProps {
  name: string
  email: string
  appearanceTheme: 'system' | 'light' | 'dark'
  appearanceTableSize: TableSize
  azDoOrganizationUrl: string
  azDoProject: string
  azDoPat: string
  azDoInterval: number
  azDoValidationMessage: string
  azDoValidationState: 'none' | 'error' | 'success' | 'warning' | undefined
  profiles: PrProfile[]
}

export interface SettingPageProps {
  state: SettingStateProps
  actions: {
    onChangeHandler: any
    validateAzDo: any
    saveSettings: any
  }
  saving: boolean
  validatingAzDo: boolean
}

export const SettingsContext = createContext<SettingPageProps>({
  state: {
    appearanceTheme: 'system',
    appearanceTableSize: TableSize.Small,
    name: '',
    email: '',
    azDoOrganizationUrl: '',
    azDoProject: '',
    azDoPat: '',
    azDoInterval: 60,
    azDoValidationMessage: '',
    azDoValidationState: 'none',
    profiles: [],
  },
  actions: {
    onChangeHandler: () => {},
    validateAzDo: () => {},
    saveSettings: () => {},
  },
  saving: false,
  validatingAzDo: false,
})
