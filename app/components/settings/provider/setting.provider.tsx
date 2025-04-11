import { SettingsModel, TableSize } from '@/lib/models/settings.model'
import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react'
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
    azDoInterval: 60,
    azDoValidationMessage: '',
    azDoValidationState: 'none',
    appearanceTheme: 'system',
    appearanceTableSize: TableSize.Small,
    profiles: [],
  })

  const convertSettings = (settings: SettingsModel): SettingStateProps => {
    return {
      appearanceTheme: settings.appearance.theme,
      name: '',
      email: '',
      azDoOrganizationUrl: settings.azDo.organizationUrl,
      azDoProject: settings.azDo.project,
      azDoPat: settings.azDo.pat,
      azDoInterval: settings.azDo.updateInterval,
      azDoValidationMessage: '',
      azDoValidationState: 'none',
      appearanceTableSize: settings.appearance.tableSize,
      profiles: settings.profiles,
    }
  }

  useEffect(() => {
    async function fetchData() {
      await window.api.invoke('get-settings').then((settings: SettingsModel) => {
        return setFormData(convertSettings(settings))
      })
    }

    fetchData()
  }, [])

  useEffect(() => {
    return window.api.receive('settings', (data: SettingsModel) => {
      setFormData(convertSettings(data))
    })
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
      const model: SettingsModel = {
        azDo: {
          organizationUrl: formData.azDoOrganizationUrl,
          project: formData.azDoProject,
          pat: formData.azDoPat,
          updateInterval: formData.azDoInterval,
        },
        appearance: {
          theme: formData.appearanceTheme,
          tableSize: formData.appearanceTableSize,
        },
        profiles: formData.profiles,
      }
      await window.api.invoke('save-settings', model)
    } finally {
      setSaving(false)
    }
  }

  const value: SettingPageProps = useMemo(
    () => ({
      state: formData,
      actions: {
        onChangeHandler: handleChange,
        validateAzDo,
        saveSettings,
      },
      saving: saving,
      validatingAzDo: validatingAzDo,
    }),
    []
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
