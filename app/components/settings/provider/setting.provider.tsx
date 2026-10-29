import { PrProfile } from '@/lib/models/pr-profile'
import { parseProfileFilter } from '@/lib/models/profile-filter.schema'
import { SettingsModel, TableSize } from '@/lib/models/settings.model'
import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { SettingPageProps, SettingsContext, SettingStateProps, SettingStatePrProfile } from '../context'
import { getProfileFilterValidation } from '../validation-helper'

interface Props {
  children: ReactNode
}

export const SettingProvider = ({ children }: Props) => {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
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
    const filter = profile.filter === undefined ? '' : JSON.stringify(profile.filter, null, 2)
    return {
      id: profile.id,
      label: profile.label,
      isDefault: profile.isDefault,
      enableAcceptAll: profile.enableAcceptAll,
      visible: profile.visible,
      sorting: profile.sorting,
      filter,
      notifyOnNewPrs: profile.notifyOnNewPrs,
      ...getProfileFilterValidation(filter),
    }
  }

  const convertProfilesToModel = (profile: SettingStatePrProfile): PrProfile => {
    return {
      id: profile.id,
      label: profile.label,
      isDefault: profile.isDefault,
      enableAcceptAll: profile.enableAcceptAll,
      visible: profile.visible,
      sorting: profile.sorting,
      notifyOnNewPrs: profile.notifyOnNewPrs,
      filter: parseProfileFilter(profile.filter ?? ''),
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
    setSaveError('')
    const { value } = e.target

    if ('profileId' in e) {
      const profileId = e.profileId
      const updatedProfile = formData.profiles.find((profile) => profile.id === profileId)
      if (!updatedProfile) {
        return
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
          profile.id === profileId
            ? {
                ...profile,
                [e.target.name]: value,
                ...(e.target.name === 'filter' ? getProfileFilterValidation(value) : {}),
              }
            : profile
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
    setSaveError('')
    try {
      const profiles = formData.profiles.map((profile) => ({
        ...profile,
        ...getProfileFilterValidation(profile.filter),
      }))
      setFormData((previous) => ({ ...previous, profiles }))
      const invalid = profiles.find((profile) => !profile.filterValid)
      if (invalid) throw new Error(`Invalid filter for profile "${invalid.label}": ${invalid.filterValidationMessage}`)

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
        profiles: profiles.map(convertProfilesToModel),
      }
      await globalThis.api.invoke('save-settings', model)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save settings. Please try again.')
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
      ...getProfileFilterValidation(''),
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
      saveError,
      validatingAzDo: validatingAzDo,
    }),
    [formData, saving, saveError, validatingAzDo]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
