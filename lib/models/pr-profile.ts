import { PrVote } from './pr-vote'
import { PullRequestFilter } from './ui-filter.model'

export interface PrProfile {
  id: string
  label: string
  isDefault?: boolean
  enableAcceptAll: boolean
  filter?: PullRequestFilter
}

export const defaultProfiles: PrProfile[] = [
  {
    id: 'builtin:all',
    label: 'All',
    isDefault: false,
    enableAcceptAll: false,
  },
  {
    id: 'automations',
    label: 'Automations',
    isDefault: false,
    enableAcceptAll: true,
    filter: {
      author: {
        op: 'AND',
        filters: [
          {
            isBot: true,
          },
        ],
      },
    },
  },
  {
    // TODO
    id: 'todo',
    label: 'To do',
    isDefault: true,
    enableAcceptAll: false,
    filter: {
      reviewers: {
        op: 'OR',
        filters: [
          {
            user: {
              isMySelf: true,
            },
            vote: PrVote.NoVote,
          },
        ],
      },
    },
  },
  {
    id: 'my',
    label: 'My own',
    isDefault: false,
    enableAcceptAll: false,
    filter: {
      author: {
        op: 'AND',
        filters: [
          {
            isMySelf: true,
          },
        ],
      },
    },
  },
  {
    id: 'my-team',
    label: 'My Team',
    isDefault: false,
    enableAcceptAll: false,
    filter: {
      reviewers: {
        op: 'AND',
        filters: [
          {
            user: {
              isMySelf: true,
            },
          },
        ],
      },
    },
  },
]
