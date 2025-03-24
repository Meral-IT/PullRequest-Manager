import { createContext } from 'react'

export interface SettingStateProps {
  name: string
  email: string
  appearanceTheme: string
  azDoOrganizationUrl: string
  azDoProject: string
  azDoPat: string
  azDoValidationMessage: string
  azDoValidationState: 'none' | 'error' | 'success' | 'warning' | undefined
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
    name: '',
    email: '',
    azDoOrganizationUrl: '',
    azDoProject: '',
    azDoPat: '',
    azDoValidationMessage: '',
    azDoValidationState: 'none',
  },
  actions: {
    onChangeHandler: () => {},
    validateAzDo: () => {},
    saveSettings: () => {},
  },
  saving: false,
  validatingAzDo: false,
})
