import { PrVote } from './pr-vote'
import { PullRequestFilter } from './ui-filter.model'

export interface PrProfile {
  id: string
  label: string
  isDefault?: boolean
  enableAcceptAll: boolean
  visible: boolean
  filter?: PullRequestFilter
  notifyOnNewPrs: boolean
}

export const defaultProfiles: PrProfile[] = [
  {
    id: 'builtin:all',
    label: 'All',
    isDefault: false,
    enableAcceptAll: false,
    visible: true,
    notifyOnNewPrs: false,
  },
  {
    id: 'automations',
    label: 'Automations',
    isDefault: false,
    visible: true,
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
    notifyOnNewPrs: false,
  },
  {
    id: 'todo',
    label: 'To do',
    isDefault: true,
    visible: true,
    enableAcceptAll: false,
    filter: {
      op: 'AND',
      filters: [
        {
          isDraft: false,
          author: {
            op: 'AND',
            filters: [
              {
                isMySelf: false,
              }
            ]
          },
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
    notifyOnNewPrs: true,
  },
  {
    id: 'my',
    label: 'My own',
    isDefault: false,
    visible: true,
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
    notifyOnNewPrs: false,
  },
  {
    id: 'my-team',
    label: 'My Team',
    isDefault: false,
    visible: true,
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
    notifyOnNewPrs: false,
  },
]
