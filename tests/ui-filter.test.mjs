import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const load = createRequire(import.meta.url)
load.extensions['.ts'] = (loaded, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  })
  loaded._compile(outputText, filename)
}
const { FilterEvaluator } = load('../lib/models/ui-filter.model.ts')
const { PrVote } = load('../lib/models/pr-vote.ts')
const { PullRequestMergeStatus } = load('../lib/models/pull-request.model.ts')

function pullRequest(id, vote) {
  return {
    id,
    author: { id: 'author', label: 'Author' },
    lastUpdated: { label: '', timestamp: 0 },
    details: {
      label: `PR ${id}`,
      number: id,
      repositoryId: 'repository',
      repository: 'Repository',
      projectId: 'project',
      branch: 'feature',
      targetBranch: 'main',
    },
    reviewers: [{ user: { id: 'me', label: 'Me', isMySelf: true }, vote, reviewedBy: [] }],
    isDraft: false,
    urls: { web: `https://example.com/pr/${id}` },
    mergeStatus: PullRequestMergeStatus.NotSet,
    evaluations: [],
  }
}

function reviewerFilter(filter) {
  return {
    op: 'AND',
    filters: [{ reviewers: { op: 'AND', filters: [{ user: { isMySelf: true }, ...filter }] } }],
  }
}

const pullRequests = [
  pullRequest(1, PrVote.NoVote),
  pullRequest(2, PrVote.Rejected),
  pullRequest(3, PrVote.WaitingForAuthor),
  pullRequest(4, PrVote.Approved),
  pullRequest(5, PrVote.ApprovedWithSuggestions),
  pullRequest(6, PrVote.Approved),
  pullRequest(7, PrVote.NoVote),
  pullRequest(8, PrVote.Rejected),
]
pullRequests[5].reviewers.push({
  user: { id: 'other', label: 'Other' },
  vote: PrVote.Rejected,
  reviewedBy: [],
})
pullRequests[6].reviewers = []
pullRequests[7].reviewers.push({
  user: { id: 'other', label: 'Other' },
  vote: PrVote.Approved,
  reviewedBy: [],
})

test('unapproved reviewer filters agree for objects, JSON, and profile evaluation', () => {
  const notApproved = reviewerFilter({ isApproved: false })
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, notApproved).map((pr) => pr.id),
    [1, 2, 3, 8]
  )
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, JSON.stringify(notApproved)).map((pr) => pr.id),
    [1, 2, 3, 8]
  )
  assert.deepEqual(
    pullRequests.filter((pr) => FilterEvaluator.evaluateProfiles(pr, [notApproved])).map((pr) => pr.id),
    [1, 2, 3, 8]
  )
})

test('approved reviewer filters include approvals with suggestions', () => {
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, reviewerFilter({ isApproved: true })).map((pr) => pr.id),
    [4, 5, 6]
  )
})

test('unapproved reviewer filters can match reviewers other than the current user', () => {
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, reviewerFilter({ user: undefined, isApproved: false })).map((pr) => pr.id),
    [1, 2, 3, 6, 8]
  )
})

test('explicit votes retain their meaning with and without approval filters', () => {
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, reviewerFilter({ vote: PrVote.NoVote, isApproved: false })).map(
      (pr) => pr.id
    ),
    [1]
  )
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, reviewerFilter({ vote: PrVote.NoVote })).map((pr) => pr.id),
    [1]
  )
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, reviewerFilter({ vote: PrVote.Approved })).map((pr) => pr.id),
    [4, 6]
  )
})

test('empty reviewer filters require a matching current-user reviewer', () => {
  assert.deepEqual(
    FilterEvaluator.evaluate(pullRequests, reviewerFilter({})).map((pr) => pr.id),
    [1, 2, 3, 4, 5, 6, 8]
  )
})
