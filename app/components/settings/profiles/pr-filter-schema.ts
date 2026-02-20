export const PR_FILTER_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'PullRequestFilter',
  description: 'Filter configuration for pull request profiles',
  type: 'object',
  required: ['op', 'filters'],
  additionalProperties: false,
  properties: {
    op: {
      type: 'string',
      enum: ['AND', 'OR'],
      description: 'Logical operator to combine filter nodes',
    },
    filters: {
      type: 'array',
      description: 'List of filter nodes to evaluate',
      items: {
        $ref: '#/definitions/FilterNode',
      },
    },
  },
  definitions: {
    FilterNode: {
      type: 'object',
      description: 'A single filter condition',
      additionalProperties: false,
      properties: {
        isDraft: {
          type: 'boolean',
          description: 'Filter by draft status',
        },
        author: {
          description: 'Filter by PR author',
          type: 'object',
          required: ['op', 'filters'],
          additionalProperties: false,
          properties: {
            op: { type: 'string', enum: ['AND', 'OR'] },
            filters: {
              type: 'array',
              items: { $ref: '#/definitions/UserFilter' },
            },
          },
        },
        reviewers: {
          description: 'Filter by PR reviewers',
          type: 'object',
          required: ['op', 'filters'],
          additionalProperties: false,
          properties: {
            op: { type: 'string', enum: ['AND', 'OR'] },
            filters: {
              type: 'array',
              items: { $ref: '#/definitions/ReviewerFilter' },
            },
          },
        },
        targetBranch: {
          description: 'Filter by target branch name',
          type: 'object',
          required: ['op', 'filters'],
          additionalProperties: false,
          properties: {
            op: { type: 'string', enum: ['AND', 'OR'] },
            filters: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        sourceBranch: {
          description: 'Filter by source branch name',
          type: 'object',
          required: ['op', 'filters'],
          additionalProperties: false,
          properties: {
            op: { type: 'string', enum: ['AND', 'OR'] },
            filters: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    UserFilter: {
      type: 'object',
      description: 'Filter for a user',
      additionalProperties: false,
      properties: {
        label: {
          type: 'string',
          description: 'User display name',
        },
        id: {
          type: 'string',
          description: 'User unique identifier',
        },
        isBot: {
          type: 'boolean',
          description: 'Is the user a bot',
        },
        isMySelf: {
          type: 'boolean',
          description: 'Is the user the current user',
        },
      },
    },
    ReviewerFilter: {
      type: 'object',
      description: 'Filter for a reviewer',
      additionalProperties: false,
      properties: {
        user: {
          $ref: '#/definitions/UserFilter',
          description: 'Reviewer user filter',
        },
        isRequired: {
          type: 'boolean',
          description: 'Is the reviewer required',
        },
        vote: {
          type: 'integer',
          enum: [10, 5, 0, -5, -10],
          description:
            'Reviewer vote: Approved (10), ApprovedWithSuggestions (5), NoVote (0), WaitingForAuthor (-5), Rejected (-10)',
        },
      },
    },
  },
}
