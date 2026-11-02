import { ErrorDetail } from './error-detail'
import { PullRequest } from './pull-request.model'
import type { AzureDevOpsAccess } from './azure-devops-access'
import type { GitHubAccess } from './github-access'

export type IntegrationStatus = {
  id: string
  name: string
  error: ErrorDetail | null
} & ({ type: 'azure-devops'; access?: AzureDevOpsAccess } | { type: 'github'; access?: GitHubAccess })

export type PullRequestData = {
  items: PullRequest[]

  error: ErrorDetail | null
  access?: AzureDevOpsAccess
  integrations?: IntegrationStatus[]
}
