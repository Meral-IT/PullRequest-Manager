import { Schema, Validator } from 'jsonschema'
import { PrVote } from './pr-vote'
import type { PullRequestFilter } from './ui-filter.model'

const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  additionalProperties: false,
  // jsonschema looks up property names through the map's prototype, too.
  properties: Object.assign(Object.create(null), properties),
})

const combination = (items: Schema): Schema => ({
  ...object({
    op: { enum: ['AND', 'OR'], description: 'Require all conditions (AND) or at least one condition (OR).' },
    filters: { type: 'array', items, description: 'Conditions to combine.' },
  }),
  required: ['op', 'filters'],
})

export const profileFilterSchema: Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://pullrequest-manager.local/schemas/profile-filter.json',
  title: 'Pull request filter',
  description: 'Filter pull requests by author, reviewers, draft status, or branch.',
  ...combination({ $ref: '#/definitions/condition' }),
  definitions: {
    condition: object({
      author: { ...combination({ $ref: '#/definitions/user' }), description: 'Match the pull request author.' },
      reviewers: { ...combination({ $ref: '#/definitions/reviewer' }), description: 'Match pull request reviewers.' },
      isDraft: { type: 'boolean', description: 'Whether the pull request is a draft.' },
      targetBranch: {
        ...combination({ type: 'string' }),
        description: 'Match target branches, with or without refs/heads/.',
      },
      sourceBranch: {
        ...combination({ type: 'string' }),
        description: 'Match source branches, with or without refs/heads/.',
      },
    }),
    user: object({
      label: { type: 'string', description: 'The user display name.' },
      id: { type: 'string', description: 'The Azure DevOps user ID.' },
      isBot: { type: 'boolean', description: 'Whether the user is a bot.' },
      isMySelf: { type: 'boolean', description: 'Whether the user is the signed-in user.' },
    }),
    reviewer: object({
      user: { $ref: '#/definitions/user' },
      isRequired: { type: 'boolean', description: 'Whether the reviewer is required.' },
      isApproved: {
        type: 'boolean',
        description: 'Whether the reviewer approved, including approval with suggestions.',
      },
      vote: {
        type: 'integer',
        enum: Object.values(PrVote).filter((vote) => typeof vote === 'number'),
        description: '10: approved; 5: approved with suggestions; 0: no vote; -5: waiting for author; -10: rejected.',
      },
    }),
  },
}

const validator = new Validator()

export function getProfileFilterErrors(filter: unknown): string[] {
  return validator
    .validate(filter, profileFilterSchema, { required: true })
    .errors.map((error) => error.stack.replace(/^instance/, 'filter'))
}

export function parseProfileFilter(text: string): PullRequestFilter | undefined {
  if (!text.trim()) return undefined

  let filter: PullRequestFilter
  try {
    filter = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid filter JSON: ${error instanceof Error ? error.message : 'Check the JSON syntax.'}`, {
      cause: error,
    })
  }

  const errors = getProfileFilterErrors(filter)
  if (errors.length) throw new Error(errors.join('; '))
  return filter
}
