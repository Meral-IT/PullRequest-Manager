import { PrProfile } from './pr-profile'

export interface AzDoSettings {
  organizationUrl: string
  project: string
  pat: string
  updateInterval: number
  intelligentApproval: boolean
  acknowledgedScopeRequirements?: string
}

export interface AzDoIntegration extends AzDoSettings {
  type: 'azure-devops'
  id: string
  name: string
  repositories?: never
}

export interface GitHubIntegration {
  type: 'github'
  id: string
  name: string
  repositories: string[]
  pat: string
  updateInterval: number
  intelligentApproval: boolean
  organizationUrl?: never
  project?: never
  acknowledgedScopeRequirements?: never
}

export type Integration = AzDoIntegration | GitHubIntegration
export type IntegrationType = Integration['type']

export function sameIntegrationConnection(a: Integration, b: Integration): boolean {
  return (
    a.type === b.type &&
    a.pat === b.pat &&
    (a.type === 'azure-devops'
      ? a.organizationUrl === b.organizationUrl && a.project === b.project
      : JSON.stringify(a.repositories) === JSON.stringify(b.repositories))
  )
}

export function normalizeRepositories(repositories: string[]): string[] {
  return [...new Set(repositories.map((repository) => repository.trim().toLowerCase()).filter(Boolean))]
}

export function validGitHubRepository(repository: string): boolean {
  return /^[a-z\d-]+\/[a-z\d_.-]+$/i.test(repository) && !['.', '..'].includes(repository.split('/')[1])
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark'
  tableSize: TableSize
}

export enum TableSize {
  ExtraSmall = 'extra-small',
  Small = 'small',
  Medium = 'medium',
}

export interface GeneralSettings {
  openAtLogin: boolean
  enableNotifications: boolean
  notificationSound: boolean
  repositoriesRootDirectory: string
}

export interface SettingsModel {
  general: GeneralSettings
  appearance: AppearanceSettings
  integrations: Integration[]
  profiles: PrProfile[]
}
