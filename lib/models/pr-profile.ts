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
      op: 'AND',
      filters: [
        {
          author: {
            op: 'AND',
            filters: [
              {
                isBot: true,
              },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'todo',
    label: 'To do',
    isDefault: true,
    enableAcceptAll: false,
    filter: {
      op: 'AND',
      filters: [
        {
          reviewers: {
            op: 'AND',
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
      ],
    },
  },
  {
    id: 'my',
    label: 'My own',
    isDefault: false,
    enableAcceptAll: false,
    filter: {
      op: 'AND',
      filters: [
        {
          author: {
            op: 'AND',
            filters: [{ isMySelf: true }],
          },
        },
      ],
    },
  },
  {
    id: 'my-team',
    label: 'My Team',
    isDefault: false,
    enableAcceptAll: false,
    filter: {
      op: 'AND',
      filters: [
        {
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
      ],
    },
  },
]
