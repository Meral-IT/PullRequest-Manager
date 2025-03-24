import { ChangeEvent, ReactNode, useEffect, useState } from 'react'
import { SettingPageProps, SettingsContext, SettingStateProps } from '../context'

interface Props {
  children: ReactNode
}

export const SettingProvider = ({ children }: Props) => {
  const [saving, setSaving] = useState(false)
  const [validatingAzDo, setValidatingAzDo] = useState(false)
  const [formData, setFormData] = useState<SettingStateProps>({
    name: '',
    email: '',
    azDoOrganizationUrl: '',
    azDoProject: '',
    azDoPat: '',
    azDoValidationMessage: '',
    azDoValidationState: 'none',
    appearanceTheme: 'system',
  })

  useEffect(() => {
    async function fetchData() {
      await window.api.invoke('get-settings').then((settings) => {
        return setFormData({
          appearanceTheme: settings.appearance.theme,
          name: '',
          email: '',
          azDoOrganizationUrl: settings.azDo.organizationUrl,
          azDoProject: settings.azDo.project,
          azDoPat: settings.azDo.pat,
          azDoValidationMessage: '',
          azDoValidationState: 'none',
        })
      })
    }

    fetchData()
  }, [])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target

    setFormData((prevFormData) => ({
      ...prevFormData,
      [e.target.name]: value,
    }))
  }

  const validateAzDo = async () => {
    setValidatingAzDo(true)
    try {
      const response = await window.api.invoke('validate-azure-devops', {
        organizationUrl: formData.azDoOrganizationUrl,
        project: formData.azDoProject,
        pat: formData.azDoPat,
      })

      setFormData((prevFormData) => ({
        ...prevFormData,
        azDoValidationMessage: response.error ? response.error.toString() : `Connected as ${response.userDisplayName}`,
        azDoValidationState: response.error ? 'error' : 'success',
      }))
    } finally {
      setValidatingAzDo(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await window.api.invoke('save-settings', {
        azDo: {
          organizationUrl: formData.azDoOrganizationUrl,
          project: formData.azDoProject,
          pat: formData.azDoPat,
        },
        appearance: {
          theme: formData.appearanceTheme,
        },
      })
    } finally {
      setSaving(false)
    }
  }

  const value: SettingPageProps = {
    state: formData,
    actions: {
      onChangeHandler: handleChange,
      validateAzDo,
      saveSettings,
    },
    saving: saving,
    validatingAzDo: validatingAzDo,
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
