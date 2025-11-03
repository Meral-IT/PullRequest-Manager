import { PrVote } from './pr-vote.js'
import { User } from './user.model.js'

export type LastUpdatedCell = {
  label: string
  timestamp: number
}

export type CommentsCell = {
  total: number
  automated: number
  user: number
}

export enum PullRequestMergeStatus {
  /**
   * Status is not set. Default state.
   */
  NotSet = 0,
  /**
   * Pull request merge is queued.
   */
  Queued = 1,
  /**
   * Pull request merge failed due to conflicts.
   */
  Conflicts = 2,
  /**
   * Pull request merge succeeded.
   */
  Succeeded = 3,
  /**
   * Pull request merge rejected by policy.
   */
  RejectedByPolicy = 4,
  /**
   * Pull request merge failed.
   */
  Failure = 5,
}

export type DetailsCell = {
  label: string
  number: number
  repositoryId: string
  repository: string
  projectId: string
  branch: string
  targetBranch: string
  isDraft?: boolean
  isConflict?: boolean
}

export type BasicReviewerProps = {
  user: User
  vote: PrVote
}

export type Reviewer = {
  isRequired?: boolean
  reviewedBy: BasicReviewerProps[]
} & BasicReviewerProps

export type ReviewerState = {
  id: string
  state: string
}

export type PullRequest = {
  id: number
  author: User
  creationDate?: Date
  lastUpdated: LastUpdatedCell
  details: DetailsCell
  reviewers: Reviewer[]
  isDraft: boolean
  urls: PullRequestUrls
  mergeStatus: PullRequestMergeStatus
  mergeFailureMessage?: string
  evaluations: PullRequestPolicyEvaluationRecord[]
}

export type PullRequestPolicyEvaluationRecord = {
  id: string
  config: PullRequestPolicyConfig
  status: PullRequestPolicyEvaluationStatus
  displayName: string
}

export type PullRequestPolicyType = {
  id: string
  displayName: string
  url: string
}

export type PullRequestPolicyConfig = {
  type: PullRequestPolicyType
}

export enum PullRequestPolicyEvaluationStatus {
  /**
   * The policy is either queued to run, or is waiting for some event before progressing.
   */
  Queued = 0,
  /**
   * The policy is currently running.
   */
  Running = 1,
  /**
   * The policy has been fulfilled for this pull request.
   */
  Approved = 2,
  /**
   * The policy has rejected this pull request.
   */
  Rejected = 3,
  /**
   * The policy does not apply to this pull request.
   */
  NotApplicable = 4,
  /**
   * The policy has encountered an unexpected error.
   */
  Broken = 5,
}

export type PullRequestUrls = {
  web: string
}
