import { PrProfile } from '@/lib/models/pr-profile'
import { SettingsModel, TableSize } from '@/lib/models/settings.model'
import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { SettingPageProps, SettingsContext, SettingStateProps, SettingStatePrProfile } from '../context'
import { validateProfileFilter } from '../validation-helper'

interface Props {
  children: ReactNode
}

export const SettingProvider = ({ children }: Props) => {
  const [saving, setSaving] = useState(false)
  const [validatingAzDo, setValidatingAzDo] = useState(false)
  const [formData, setFormData] = useState<SettingStateProps>({
    openAtLogin: false,
    enableNotifications: true,
    notificationSound: false,
    repositoriesRootDirectory: '',
    name: '',
    email: '',
    azDoOrganizationUrl: '',
    azDoProject: '',
    azDoPat: '',
    azDoInterval: 60,
    azDoValidationMessage: '',
    azDoValidationState: 'none',
    azDoIntelligentApproval: true,
    appearanceTheme: 'system',
    appearanceTableSize: TableSize.Small,
    profiles: [],
  })

  const convertProfiles = (profile: PrProfile): SettingStatePrProfile => {
    return {
      id: profile.id,
      label: profile.label,
      isDefault: profile.isDefault,
      enableAcceptAll: profile.enableAcceptAll,
      visible: profile.visible,
      filter: profile.filter ? JSON.stringify(profile.filter, null, 2) : '',
      notifyOnNewPrs: profile.notifyOnNewPrs,
      filterValid: true
    }
  }

  const convertProfilesToModel = (profile: SettingStatePrProfile): PrProfile => {
    return {
      id: profile.id,
      label: profile.label,
      isDefault: profile.isDefault,
      enableAcceptAll: profile.enableAcceptAll,
      visible: profile.visible,
      notifyOnNewPrs: profile.notifyOnNewPrs,
      filter: profile.filter ? JSON.parse(profile.filter) : undefined,
    }
  }

  const convertSettings = (settings: SettingsModel): SettingStateProps => {
    return {
      openAtLogin: settings.general.openAtLogin,
      enableNotifications: settings.general.enableNotifications,
      notificationSound: settings.general.notificationSound,
      repositoriesRootDirectory: settings.general.repositoriesRootDirectory,
      appearanceTheme: settings.appearance.theme,
      name: '',
      email: '',
      azDoOrganizationUrl: settings.azDo.organizationUrl,
      azDoProject: settings.azDo.project,
      azDoPat: settings.azDo.pat,
      azDoInterval: settings.azDo.updateInterval,
      azDoIntelligentApproval: settings.azDo.intelligentApproval,
      azDoValidationMessage: '',
      azDoValidationState: 'none',
      appearanceTableSize: settings.appearance.tableSize,
      profiles: settings.profiles.map(convertProfiles),
    }
  }

  useEffect(() => {
    async function fetchData() {
      await globalThis.api.invoke('get-settings').then((settings: SettingsModel) => {
        return setFormData(convertSettings(settings))
      })
    }

    fetchData()
  }, [])

  useEffect(() => {
    return globalThis.api.receive('settings', (data: SettingsModel) => {
      setFormData(convertSettings(data))
    })
  }, [])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target

    if ('profileId' in e) {
      const profileId = e.profileId
      const updatedProfile = formData.profiles.find((profile) => profile.id === profileId)
      if (!updatedProfile) {
        return
      }

      if (e.target.name === 'filter') {
        const isValid = validateProfileFilter(value)
        updatedProfile.filterValid = isValid
      }

      if (updatedProfile.isDefault) {
        for (const profile of formData.profiles) {
          if (profile.id !== profileId) {
            profile.isDefault = false
          }
        }
      }

      setFormData((prevFormData) => ({
        ...prevFormData,
        profiles: prevFormData.profiles.map((profile) =>
          profile.id === profileId ? { ...profile, [e.target.name]: value } : profile
        ),
      }))
      return
    }

    setFormData((prevFormData) => ({
      ...prevFormData,
      [e.target.name]: value,
    }))
  }

  const validateAzDo = async () => {
    setValidatingAzDo(true)
    try {
      const response = await globalThis.api.invoke('validate-azure-devops', {
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
        general: {
          openAtLogin: formData.openAtLogin,
          enableNotifications: formData.enableNotifications,
          notificationSound: formData.notificationSound,
          repositoriesRootDirectory: formData.repositoriesRootDirectory,
        },
        azDo: {
          organizationUrl: formData.azDoOrganizationUrl,
          project: formData.azDoProject,
          pat: formData.azDoPat,
          updateInterval: formData.azDoInterval,
          intelligentApproval: formData.azDoIntelligentApproval,
        },
        appearance: {
          theme: formData.appearanceTheme,
          tableSize: formData.appearanceTableSize,
        },
        profiles: formData.profiles.map(convertProfilesToModel),
      }
      await globalThis.api.invoke('save-settings', model)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteProfile = (id: string) => {
    setFormData((prevFormData) => ({
      ...prevFormData,
      profiles: prevFormData.profiles.filter((profile) => profile.id !== id),
    }))
  }

  const handleDuplicateProfile = (profileId: string) => {
    const profile = formData.profiles.find((p) => p.id === profileId)
    if (!profile) return
    const newProfile = {
      ...profile,
      id: crypto.randomUUID(),
      label: `${profile.label} (copy)`,
    }
    setFormData((prevFormData) => ({
      ...prevFormData,
      profiles: [...prevFormData.profiles, newProfile],
    }))
  }

  const handleAddProfile = () => {
    const newProfile: SettingStatePrProfile = {
      id: crypto.randomUUID(),
      label: 'New profile',
      visible: true,
      enableAcceptAll: false,
      notifyOnNewPrs: false,
      isDefault: false,
      filter: '',
      filterValid: true
    }
    setFormData((prevFormData) => ({
      ...prevFormData,
      profiles: [...prevFormData.profiles, newProfile],
    }))
  }

  const value: SettingPageProps = useMemo(
    () => ({
      state: formData,
      actions: {
        getInitialSettings: async () => {
          return convertSettings(await globalThis.api.invoke('get-settings'))
        },
        onChangeHandler: handleChange,
        validateAzDo,
        saveSettings,
        deleteProfile: handleDeleteProfile,
        duplicateProfile: handleDuplicateProfile,
        addProfile: handleAddProfile,
      },
      saving: saving,
      validatingAzDo: validatingAzDo,
    }),
    [formData, saving, validatingAzDo]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
