import type { PullRequest } from '../models/pull-request.model'
import { normalizeBranchName } from './name-normalizer'

export function matchesPullRequestSearch(pr: PullRequest, query: string, createdById?: string, targetBranch?: string): boolean {
  const text = query.trim().toLowerCase()
  return (createdById === undefined || pr.author.id === createdById) &&
    (!targetBranch || normalizeBranchName(pr.details.targetBranch) === normalizeBranchName(targetBranch)) &&
    (!text || [pr.details.repository, pr.author.label, pr.details.label, pr.details.description]
      .some((value) => value?.toLowerCase().includes(text)))
}
