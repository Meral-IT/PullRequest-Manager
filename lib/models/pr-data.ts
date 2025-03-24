import { ErrorDetail } from './error-detail'
import { PullRequest } from './pull-request.model'

export type PullRequestData = {
  items: PullRequest[]

  error: ErrorDetail | null
}
