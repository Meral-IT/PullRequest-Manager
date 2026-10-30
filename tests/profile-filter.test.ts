import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProfileFilterValidation, validateProfileFilter } from '../app/components/settings/validation-helper'
import { getProfileFilterErrors, parseProfileFilter } from '../lib/models/profile-filter.schema'
import { defaultProfiles } from '../lib/models/pr-profile'
import { FilterEvaluator, PullRequestFilter } from '../lib/models/ui-filter.model'
import { PullRequest } from '../lib/models/pull-request.model'

test('all built-in filters remain valid', () => {
  for (const profile of defaultProfiles) {
    assert.equal(validateProfileFilter(profile.filter ? JSON.stringify(profile.filter) : ''), true, profile.label)
  }
})

test('only supported operators and properties are accepted', () => {
  for (const filter of [
    { op: 'XOR', filters: [] },
    { op: 'AND', filters: [], extra: true },
    { op: 'AND', filters: [{ reveiwers: {} }] },
    { op: 'AND', filters: [{ isDraft: 'false' }] },
    { op: 'AND', filters: [{ author: { op: 'AND', filters: [null] } }] },
    { op: 'AND', filters: [{ reviewers: { op: 'OR', filters: [{ vote: 7 }] } }] },
    { op: 'AND', filters: [{ targetBranch: { op: 'OR', filters: [3] } }] },
    { op: 'AND', filters: [{ sourceBranch: { op: 'AND', filters: [null] } }] },
  ]) {
    assert.equal(validateProfileFilter(JSON.stringify(filter)), false, JSON.stringify(filter))
  }
})

test('blank and whitespace-only filters mean no filtering', () => {
  assert.equal(validateProfileFilter(''), true)
  assert.equal(validateProfileFilter(' \n\t '), true)
  assert.equal(parseProfileFilter(' \n\t '), undefined)
})

test('schema errors identify the nested property that needs repair', () => {
  const result = getProfileFilterValidation(
    '{"op":"AND","filters":[{"author":{"op":"AND","filters":[{"isBot":"yes"}]}}]}'
  )
  assert.equal(result.filterValid, false)
  assert.match(result.filterValidationMessage, /filter\.filters\[0\]\.author\.filters\[0\]\.isBot/)
  assert.equal(getProfileFilterValidation('null').filterValid, false)
  assert.equal(getProfileFilterValidation().filterValid, true)
})

test('every supported nested field and vote can be saved without rewriting values', () => {
  for (const vote of [-10, -5, 0, 5, 10]) {
    const filter = {
      op: 'OR',
      filters: [
        {
          author: { op: 'AND', filters: [{ label: 'Jane', id: 'user-1', isBot: false, isMySelf: true }, {}] },
          reviewers: {
            op: 'OR',
            filters: [{ user: { label: 'Team', id: 'team-1', isBot: true, isMySelf: false }, isRequired: false, vote }],
          },
          isDraft: false,
          targetBranch: { op: 'OR', filters: ['main', 'refs/heads/develop'] },
          sourceBranch: { op: 'AND', filters: [] },
        },
      ],
    }
    assert.deepEqual(parseProfileFilter(JSON.stringify(filter)), filter)
  }
})

test('invalid roots, missing combination fields and invalid nested types are rejected', () => {
  for (const value of [
    null,
    true,
    1,
    'text',
    [],
    {},
    { op: 'AND' },
    { filters: [] },
    { op: 'AND', filters: [null] },
    { op: 'AND', filters: [{ author: { filters: [] } }] },
    { op: 'AND', filters: [{ reviewers: { op: 'AND', filters: [{ user: null }] } }] },
    { op: 'AND', filters: [{ reviewers: { op: 'AND', filters: [{ isRequired: 'false' }] } }] },
    { op: 'AND', filters: [{ author: { op: 'AND', filters: [{ id: 1, label: null, isMySelf: 'true' }] } }] },
    { op: 'AND', filters: [{ targetBranch: { op: 'XOR', filters: [] } }] },
    { op: 'AND', filters: [{ sourceBranch: { op: 'AND', filters: 'main' } }] },
  ])
    assert.equal(validateProfileFilter(JSON.stringify(value)), false, JSON.stringify(value))
  assert.ok(getProfileFilterErrors(undefined).length)
})

test('JSON syntax stays strict, including comments and trailing commas', () => {
  for (const text of ['{', '{"op":"AND","filters":[],}', '{/* comment */"op":"AND","filters":[]}']) {
    assert.equal(validateProfileFilter(text), false)
    assert.throws(() => parseProfileFilter(text), /JSON/)
  }
})

test('reviewer approval-state filters remain supported after schema validation', () => {
  for (const isApproved of [true, false]) {
    const filter = { op: 'AND', filters: [{ reviewers: { op: 'OR', filters: [{ isApproved }] } }] }
    assert.deepEqual(parseProfileFilter(JSON.stringify(filter)), filter)
  }
  const invalid = '{"op":"AND","filters":[{"reviewers":{"op":"AND","filters":[{"isApproved":"false"}]}}]}'
  assert.equal(validateProfileFilter(invalid), false)
  assert.match(getProfileFilterValidation(invalid).filterValidationMessage, /isApproved/)
})

test('unknown properties are rejected at every object level, including prototype names', () => {
  for (const value of [
    '{"op":"AND","filters":[],"toString":true}',
    '{"op":"AND","filters":[{"constructor":false}]}',
    '{"op":"AND","filters":[{"author":{"op":"AND","filters":[{"name":"Jane"}]}}]}',
    '{"op":"AND","filters":[{"reviewers":{"op":"AND","filters":[{"extra":true}]}}]}',
    '{"op":"AND","filters":[{"sourceBranch":{"op":"AND","filters":[],"typo":true}}]}',
  ])
    assert.equal(validateProfileFilter(value), false, value)
})

const pullRequest = { isDraft: false } as PullRequest

test('malformed filters never select all PRs or crash evaluation', () => {
  for (const filter of ['{', 'null', '{}', '{"op":"XOR","filters":[]}', '{"op":"AND","filters":[null]}']) {
    assert.deepEqual(FilterEvaluator.evaluate([pullRequest], filter), [], filter)
  }
  assert.deepEqual(FilterEvaluator.evaluate([pullRequest], { op: 'AND' } as PullRequestFilter), [])
  assert.deepEqual(FilterEvaluator.evaluate([pullRequest], null as unknown as PullRequestFilter), [])
})

test('notification matching ignores invalid profiles', () => {
  assert.equal(FilterEvaluator.evaluateProfiles(pullRequest, [{ op: 'AND' } as PullRequestFilter]), false)
  assert.equal(
    FilterEvaluator.evaluateProfiles(pullRequest, [
      { op: 'AND' } as PullRequestFilter,
      { op: 'AND', filters: [{ isDraft: false }] },
    ]),
    true
  )
})

test('empty conditions retain their existing evaluation semantics', () => {
  assert.deepEqual(FilterEvaluator.evaluate([pullRequest], { op: 'AND', filters: [] }), [pullRequest])
  assert.deepEqual(FilterEvaluator.evaluate([pullRequest], { op: 'OR', filters: [] }), [])
  assert.deepEqual(FilterEvaluator.evaluate([pullRequest], { op: 'AND', filters: [{}] }), [pullRequest])
})

test('organization and project filters match names or IDs with AND/OR combinations', () => {
  const pr = {
    details: { organization: 'Example', organizationId: 'org-1', project: 'Platform', projectId: 'project-1' },
  } as unknown as PullRequest
  for (const field of ['organization', 'project']) {
    const name = field === 'organization' ? 'Example' : 'Platform'
    const id = field === 'organization' ? 'org-1' : 'project-1'
    for (const match of [{ name }, { id }, { name, id }]) {
      const filter = { op: 'AND', filters: [{ [field]: { op: 'OR', filters: [match] } }] }
      assert.equal(validateProfileFilter(JSON.stringify(filter)), true)
      assert.deepEqual(FilterEvaluator.evaluate([pr], JSON.stringify(filter)), [pr])
    }
    assert.deepEqual(
      FilterEvaluator.evaluate(
        [pr],
        JSON.stringify({ op: 'AND', filters: [{ [field]: { op: 'OR', filters: [{ name: 'other' }] } }] })
      ),
      []
    )
    assert.deepEqual(
      FilterEvaluator.evaluate(
        [pr],
        JSON.stringify({ op: 'AND', filters: [{ [field]: { op: 'AND', filters: [{ id }, { name: 'other' }] } }] })
      ),
      []
    )
    assert.equal(
      validateProfileFilter(
        JSON.stringify({ op: 'AND', filters: [{ [field]: { op: 'OR', filters: [{ id: 123 }] } }] })
      ),
      false
    )
  }
})
