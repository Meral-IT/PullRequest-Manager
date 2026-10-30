import type { AzDoSettings } from './settings.model'

export const azureDevOpsRequirements = [
  { id: 'code', scope: 'vso.code', label: 'Code (Read)', features: 'PR listing and policy status', required: true },
  {
    id: 'identity',
    scope: 'vso.identity',
    label: 'Identity (Read)',
    features: 'Team membership and reviewer matching',
    required: true,
  },
  {
    id: 'vote',
    scope: 'vso.code_write',
    label: 'Code (Read & write)',
    features: 'Approving PRs and resetting votes',
    required: false,
  },
] as const

export type AzureDevOpsFeature = (typeof azureDevOpsRequirements)[number]['id']
export type AzureDevOpsConnection = Pick<AzDoSettings, 'organizationUrl' | 'project' | 'pat'>
export type AzureDevOpsAccessResult = {
  status: 'verified' | 'denied' | 'unverified'
  message: string
  reason?: 'authentication' | 'authorization' | 'configuration' | 'temporary'
}
export type AzureDevOpsAccess = {
  requirementsFingerprint: string
  connectionRevision: number
  acknowledged: boolean
  features: Record<AzureDevOpsFeature, AzureDevOpsAccessResult>
}
export type AzureDevOpsValidationResult = {
  userDisplayName: string | null
  error: string | null
  access: AzureDevOpsAccess
}

// Include feature names and required/optional classification so either change prompts another review.
export const AZURE_DEVOPS_REQUIREMENTS_FINGERPRINT = JSON.stringify(azureDevOpsRequirements)

export function sameAzureDevOpsConnection(a: AzureDevOpsConnection, b: AzureDevOpsConnection): boolean {
  return a.organizationUrl === b.organizationUrl && a.project === b.project && a.pat === b.pat
}

export function createAzureDevOpsAccess(acknowledgement?: string, connectionRevision = 0): AzureDevOpsAccess {
  return {
    requirementsFingerprint: AZURE_DEVOPS_REQUIREMENTS_FINGERPRINT,
    connectionRevision,
    acknowledged: acknowledgement === AZURE_DEVOPS_REQUIREMENTS_FINGERPRINT,
    features: {
      code: { status: 'unverified', message: 'Validate the connection to check PR read access.' },
      identity: { status: 'unverified', message: 'Validate the connection to check team membership access.' },
      vote: {
        status: 'unverified',
        message: 'Checked only when you approve a PR or reset a vote. Validation never casts votes.',
      },
    },
  }
}

export function getAccessNoticeRequirements(access: AzureDevOpsAccess) {
  return azureDevOpsRequirements.filter(
    ({ id }) =>
      access.features[id].status === 'denied' || (!access.acknowledged && access.features[id].status === 'unverified')
  )
}

export function getAzureDevOpsAccessFailure(error: unknown): AzureDevOpsAccessResult {
  const status = (error as { statusCode?: number } | null)?.statusCode
  if (status === 401 || status === 203) {
    return {
      status: 'unverified',
      reason: 'authentication',
      message: 'Authentication failed. Check whether the PAT expired, was revoked, or needs additional scopes.',
    }
  }
  if (status === 403) {
    return {
      status: 'denied',
      reason: 'authorization',
      message: 'Access denied. Check PAT scopes and Azure DevOps permissions for this feature.',
    }
  }
  if (status === 400 || status === 404) {
    return {
      status: 'unverified',
      reason: 'configuration',
      message: 'Check the organization URL and project name, and whether you can access that project.',
    }
  }
  return {
    status: 'unverified',
    reason: 'temporary',
    message: 'Access could not be checked. Check your connection and try again.',
  }
}
