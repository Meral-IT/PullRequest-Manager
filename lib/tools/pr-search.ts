import type { PullRequest } from '../models/pull-request.model'
import { normalizeBranchName } from './name-normalizer'

export function matchesPullRequestSearch(pr: PullRequest, query: string, createdById?: string, targetBranch?: string): boolean {
  const text = query.trim().toLowerCase()
  return (createdById === undefined || pr.author.id === createdById) &&
    (!targetBranch || normalizeBranchName(pr.details.targetBranch) === normalizeBranchName(targetBranch)) &&
    (!text || [pr.details.repository, pr.author.label, pr.details.label, pr.details.description]
      .some((value) => value?.toLowerCase().includes(text)))
}

export function pullRequestDescriptionContext(pr: PullRequest, query: string): string | undefined {
  const text = query.trim().toLowerCase()
  if (!text || matchesPullRequestSearch({ ...pr, details: { ...pr.details, description: undefined } }, text)) return
  const description = pr.details.description ?? ''
  const lowercase = description.toLowerCase()
  let index = lowercase.indexOf(text)
  if (index < 0) return
  if (lowercase.length !== description.length) {
    let remaining = index
    index = 0
    for (const character of description) {
      const length = character.toLowerCase().length
      if (remaining < length) break
      remaining -= length
      index += character.length
    }
  }
  const start = Math.max(0, index - 48)
  const end = Math.min(description.length, start + 160)
  return `${start ? '…' : ''}${description.slice(start, end).replace(/\s+/g, ' ').trim()}${end < description.length ? '…' : ''}`
}
