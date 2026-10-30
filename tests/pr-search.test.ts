import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PullRequestMergeStatus, type PullRequest } from '../lib/models/pull-request.model'
import { matchesPullRequestSearch } from '../lib/tools/pr-search'

const pr = {
  id: 1,
  author: { id: 'author-id', label: 'Ada Lovelace' },
  lastUpdated: { label: '', timestamp: 0 },
  details: {
    number: 1,
    repositoryId: 'repo',
    repository: 'Payment.Service',
    projectId: 'project',
    branch: 'feature',
    targetBranch: 'main',
    label: 'Fix invoice [rounding]',
    description: 'Preserve decimal precision when calculating totals.',
  },
  reviewers: [],
  isDraft: false,
  urls: { web: 'https://example.com/pr/1' },
  mergeStatus: PullRequestMergeStatus.NotSet,
  evaluations: [],
} as PullRequest

test('search matches repository, author, title, and description case-insensitively', () => {
  for (const query of ['PAYMENT', 'loveLACE', '  INVOICE ', 'decimal PRECISION']) {
    assert.equal(matchesPullRequestSearch(pr, query), true, query)
  }
  for (const query of ['unrelated', 'author-id', 'Payment.Service Ada']) {
    assert.equal(matchesPullRequestSearch(pr, query), false, query)
  }
})

test('blank search includes every PR and missing descriptions are safe', () => {
  const withoutDescription = { ...pr, details: { ...pr.details, description: undefined } }
  for (const query of ['', ' \n\t ']) {
    assert.equal(matchesPullRequestSearch(withoutDescription, query), true)
  }
  assert.equal(matchesPullRequestSearch(withoutDescription, 'precision'), false)
  assert.equal(matchesPullRequestSearch(withoutDescription, 'invoice'), true)
})

test('search treats punctuation as literal text and includes the end of long descriptions', () => {
  for (const [query, expected] of [['[rounding]', true], ['Payment.Service', true], ['.*', false], ['[', true]] as const) {
    assert.equal(matchesPullRequestSearch(pr, query), expected, query)
  }
  const longDescription = { ...pr, details: { ...pr.details, description: `${'x'.repeat(500)} final paragraph` } }
  assert.equal(matchesPullRequestSearch(longDescription, 'final paragraph'), true)
})

test('author filters use IDs rather than matching display names', () => {
  const sameName = { ...pr, author: { ...pr.author, id: 'other-author' } }
  assert.equal(matchesPullRequestSearch(pr, '', 'author-id'), true)
  assert.equal(matchesPullRequestSearch(sameName, '', 'author-id'), false)
  assert.equal(matchesPullRequestSearch(pr, '', 'other-author'), false)
})

test('target branch filters normalize refs and combine with text and author using AND', () => {
  const prefixed = { ...pr, details: { ...pr.details, targetBranch: 'refs/heads/main' } }
  for (const branch of ['main', 'refs/heads/main']) {
    assert.equal(matchesPullRequestSearch(prefixed, 'invoice', 'author-id', branch), true)
    assert.equal(matchesPullRequestSearch(pr, '', undefined, branch), true)
  }
  for (const [query, author, branch] of [
    ['unrelated', 'author-id', 'main'],
    ['invoice', 'other-author', 'main'],
    ['invoice', 'author-id', 'develop'],
    ['', undefined, 'Main'],
  ]) {
    assert.equal(matchesPullRequestSearch(pr, query ?? '', author, branch), false)
  }
})
