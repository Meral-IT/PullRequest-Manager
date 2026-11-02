import { PrProfile } from '@/lib/models/pr-profile'
import { parseProfileFilter } from '@/lib/models/profile-filter.schema'
import {
  Integration,
  IntegrationType,
  SettingsModel,
  TableSize,
  sameIntegrationConnection,
} from '@/lib/models/settings.model'
import { GitHubAccess, GitHubValidationResult, createGitHubAccess } from '@/lib/models/github-access'
import { ChangeEvent, ReactNode, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import {
  AzureDevOpsAccess,
  AzureDevOpsValidationResult,
  createAzureDevOpsAccess,
  getAzureDevOpsAccessFailure,
} from '@/lib/models/azure-devops-access'
import type { PullRequestData } from '@/lib/models/pr-data'
import { SettingPageProps, SettingsContext, SettingStateProps, SettingStatePrProfile } from '../context'
import { getProfileFilterValidation } from '../validation-helper'

interface Props {
  children: ReactNode
}

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
    integrations: settings.integrations,
    appearanceTableSize: settings.appearance.tableSize,
    profiles: settings.profiles.map(convertProfiles),
  }
}

export const SettingProvider = ({ children }: Props) => {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [validatingAzDo, setValidatingAzDo] = useState(false)
  const [azDoAccess, setAzDoAccess] = useState<AzureDevOpsAccess>()
  const [azDoValidation, setAzDoValidation] = useState<AzureDevOpsValidationResult>()
  const [validatingGitHub, setValidatingGitHub] = useState(false)
  const [githubAccess, setGithubAccess] = useState<GitHubAccess>()
  const [githubValidation, setGithubValidation] = useState<GitHubValidationResult>()
  const validationRequest = useRef(0)
  const savedConnections = useRef<Integration[]>([])
  const latestData = useRef<PullRequestData | undefined>(undefined)
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('')
  const selectedId = useRef(selectedIntegrationId)
  selectedId.current = selectedIntegrationId
  const [formData, setFormData] = useState<SettingStateProps>({
    openAtLogin: false,
    enableNotifications: true,
    notificationSound: false,
    repositoriesRootDirectory: '',
    name: '',
    email: '',
    integrations: [],
    appearanceTheme: 'system',
    appearanceTableSize: TableSize.Small,
    profiles: [],
  })
  const currentForm = useRef(formData)
  currentForm.current = formData

  const resetValidation = useCallback(() => {
    validationRequest.current++
    setValidatingAzDo(false)
    setAzDoValidation(undefined)
    setAzDoAccess(undefined)
    setValidatingGitHub(false)
    setGithubValidation(undefined)
    setGithubAccess(undefined)
  }, [])

  const receiveAccess = useCallback((data: PullRequestData) => {
    latestData.current = data
    const current = currentForm.current.integrations.find((item) => item.id === selectedId.current)
    const saved = savedConnections.current.find((item) => item.id === selectedId.current)
    if (current && saved && sameIntegrationConnection(current, saved)) {
      const status = data.integrations?.find((item) => item.id === current.id)
      if (current.type === 'azure-devops' && status?.type !== 'github') setAzDoAccess(status?.access)
      if (current.type === 'github' && status?.type === 'github') setGithubAccess(status.access)
    }
  }, [])

  const receiveSettings = useCallback(
    (settings: SettingsModel) => {
      const initial = savedConnections.current.length === 0
      const previous = currentForm.current.integrations.find((item) => item.id === selectedId.current)
      const next = settings.integrations.find((item) => item.id === selectedId.current)
      if (!previous || !next || !sameIntegrationConnection(previous, next)) resetValidation()
      savedConnections.current = settings.integrations
      currentForm.current = convertSettings(settings)
      setFormData(currentForm.current)
      selectedId.current = next?.id ?? settings.integrations[0]?.id ?? ''
      setSelectedIntegrationId(selectedId.current)
      if (initial && latestData.current) receiveAccess(latestData.current)
    },
    [resetValidation, receiveAccess]
  )

  const cancelValidation = useEffectEvent(() => {
    validationRequest.current++
  })

  useEffect(() => {
    let active = true
    let settingsReceived = false
    let accessReceived = false
    const unsubscribeSettings = globalThis.api.receive('settings', (data: SettingsModel) => {
      settingsReceived = true
      receiveSettings(data)
    })
    const unsubscribeAccess = globalThis.api.receive('pr-data', (data: PullRequestData) => {
      accessReceived = true
      receiveAccess(data)
    })

    async function fetchData() {
      const settings: SettingsModel = await globalThis.api.invoke('get-settings')
      if (!active) return
      if (!settingsReceived) receiveSettings(settings)
      const request = validationRequest.current
      const data: PullRequestData = await globalThis.api.invoke('get-pr-data')
      if (active && !accessReceived && request === validationRequest.current) receiveAccess(data)
    }

    fetchData().catch((error) => {
      if (active) setSaveError(error instanceof Error ? error.message : 'Unable to load settings. Please try again.')
    })
    return () => {
      active = false
      cancelValidation()
      unsubscribeSettings()
      unsubscribeAccess()
    }
  }, [receiveSettings, receiveAccess])

  const value = useMemo<SettingPageProps>(() => {
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
      const integration = formData.integrations.find((item) => item.id === selectedIntegrationId)
      if (integration?.type !== 'azure-devops') return
      const request = ++validationRequest.current
      setValidatingAzDo(true)
      try {
        const response: AzureDevOpsValidationResult = await globalThis.api.invoke('validate-azure-devops', {
          organizationUrl: integration.organizationUrl,
          project: integration.project,
          pat: integration.pat,
          integrationId: integration.id,
        })
        if (request !== validationRequest.current) return
        setAzDoValidation(response)
        setAzDoAccess(response.access)
      } catch (error) {
        if (request !== validationRequest.current) return
        const access = createAzureDevOpsAccess()
        const failure = getAzureDevOpsAccessFailure(error)
        access.features = { code: failure, identity: failure, vote: failure }
        setAzDoValidation({ userDisplayName: null, error: failure.message, access })
        setAzDoAccess(access)
      } finally {
        if (request === validationRequest.current) setValidatingAzDo(false)
      }
    }

    const validateGitHub = async () => {
      const integration = formData.integrations.find((item) => item.id === selectedIntegrationId)
      if (integration?.type !== 'github') return
      const request = ++validationRequest.current
      setValidatingGitHub(true)
      try {
        const response: GitHubValidationResult = await globalThis.api.invoke('validate-github', integration)
        if (request !== validationRequest.current) return
        setGithubValidation(response)
        setGithubAccess(response.access)
      } catch {
        if (request === validationRequest.current)
          setGithubValidation({
            userDisplayName: null,
            error: 'Unable to validate GitHub access. Please try again.',
            access: createGitHubAccess(),
          })
      } finally {
        if (request === validationRequest.current) setValidatingGitHub(false)
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
        if (invalid)
          throw new Error(`Invalid filter for profile "${invalid.label}": ${invalid.filterValidationMessage}`)

        const model: SettingsModel = {
          general: {
            openAtLogin: formData.openAtLogin,
            enableNotifications: formData.enableNotifications,
            notificationSound: formData.notificationSound,
            repositoriesRootDirectory: formData.repositoriesRootDirectory,
          },
          integrations: formData.integrations,
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

    const selectIntegration = (id: string) => {
      resetValidation()
      selectedId.current = id
      setSelectedIntegrationId(id)
      if (latestData.current) receiveAccess(latestData.current)
    }

    const updateIntegrations = (integrations: Integration[]) => {
      currentForm.current = { ...currentForm.current, integrations: integrations }
      setFormData(currentForm.current)
      setSaveError('')
    }

    return {
      state: formData,
      actions: {
        getInitialSettings: async () => {
          return convertSettings(await globalThis.api.invoke('get-settings'))
        },
        onChangeHandler: handleChange,
        validateAzDo,
        validateGitHub,
        selectIntegration,
        addIntegration: (type: IntegrationType = 'azure-devops') => {
          const base = {
            id: crypto.randomUUID(),
            name: 'New integration',
            pat: '',
            updateInterval: 180,
            intelligentApproval: true,
          }
          const integration: Integration =
            type === 'github'
              ? { ...base, type, repositories: [] }
              : { ...base, type, organizationUrl: '', project: '' }
          updateIntegrations([...currentForm.current.integrations, integration])
          selectIntegration(integration.id)
          return integration.id
        },
        deleteIntegration: (id: string) => {
          updateIntegrations(currentForm.current.integrations.filter((item) => item.id !== id))
          if (selectedId.current === id) selectIntegration(currentForm.current.integrations[0]?.id ?? '')
        },
        updateIntegration: (id: string, changes: Partial<Integration>) => {
          if (['organizationUrl', 'project', 'pat', 'repositories'].some((field) => field in changes)) resetValidation()
          updateIntegrations(
            currentForm.current.integrations.map((item) =>
              item.id === id ? ({ ...item, ...changes, type: item.type } as Integration) : item
            )
          )
        },
        saveSettings,
        deleteProfile: handleDeleteProfile,
        duplicateProfile: handleDuplicateProfile,
        addProfile: handleAddProfile,
      },
      selectedIntegrationId,
      saving: saving,
      saveError,
      validatingAzDo: validatingAzDo,
      azDoAccess,
      azDoValidation,
      validatingGitHub,
      githubAccess,
      githubValidation,
    }
  }, [
    formData,
    saving,
    saveError,
    validatingAzDo,
    azDoAccess,
    azDoValidation,
    validatingGitHub,
    githubAccess,
    githubValidation,
    selectedIntegrationId,
    resetValidation,
    receiveAccess,
  ])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
