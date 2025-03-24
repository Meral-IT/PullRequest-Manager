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

export type DetailsCell = {
  label: string
  number: number
  repositoryId: string
  repository: string
  projectId: string
  branch: string
  isDraft?: boolean
  isConflict?: boolean
}

export type Reviewer = {
  user: User
  isRequired?: boolean
  vote: PrVote
}

export type ReviewerState = {
  id: string
  state: string
}

export type PullRequest = {
  id: number
  author: User
  lastUpdated: LastUpdatedCell
  details: DetailsCell
  reviewers: Reviewer[]
  interactions: PullRequestThreads
}

export type PullRequestThreads = {
  threads: PullRequestThread[]
  activeThreads: number
  activeFromBots: number
}

export type PullRequestThread = {
  id: number
  state: PullRequestThreadState
  comments: PullRequestComment[]
}

export type PullRequestComment = {
  id: number
  content: string
  author: User
}

export enum PullRequestThreadState {
  Unknown = 0,
  Active = 1,
  Fixed = 2,
  Closed = 4,
  ByDesign = 5,
  Pending = 6,
}

export const PullRequestThreadStateMap = {
  active: PullRequestThreadState.Active,
  fixed: PullRequestThreadState.Fixed,
  closed: PullRequestThreadState.Closed,
  byDesign: PullRequestThreadState.ByDesign,
  pending: PullRequestThreadState.Pending,
}
