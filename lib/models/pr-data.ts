import { ErrorDetail } from './error-detail'
import { PullRequest } from './pull-request.model'
import type { AzureDevOpsAccess } from './azure-devops-access'

export type PullRequestData = {
  items: PullRequest[]

  error: ErrorDetail | null
  access?: AzureDevOpsAccess
  integrations?: {
    id: string
    name: string
    access?: AzureDevOpsAccess
    error: ErrorDetail | null
  }[]
}
