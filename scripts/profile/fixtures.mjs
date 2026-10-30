// Fixed synthetic data only: no PAT, personal data, avatar URLs or Azure traffic.
export const fixtureSettings = {
  general: { openAtLogin: false, enableNotifications: false, notificationSound: false, repositoriesRootDirectory: '' },
  azDoIntegrations: [
    {
      id: 'fixture',
      name: 'Fixture',
      organizationUrl: 'https://profile.invalid',
      project: 'fixture',
      pat: '',
      updateInterval: 0.05,
      intelligentApproval: true,
    },
  ],
  appearance: { theme: 'light', tableSize: 'small' },
  profiles: [
    {
      id: 'builtin:all',
      label: 'All',
      isDefault: true,
      visible: true,
      enableAcceptAll: false,
      notifyOnNewPrs: false,
      sorting: null,
    },
    {
      id: 'fixture-review',
      label: 'Review',
      visible: true,
      enableAcceptAll: false,
      notifyOnNewPrs: false,
      filter: { op: 'AND', filters: [{ isDraft: false }] },
    },
  ],
}

export function createFixture({ count, delayMs = 1 }) {
  if (![0, 32, 1000, 10000].includes(count)) throw new Error('Unsupported fixture count')
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 1000) throw new Error('Invalid fixture delay')
  const groups = Array.from({ length: 65 }, (_, i) => ({
    id: `team-${i}`,
    descriptor: `Microsoft.TeamFoundation.Identity;team-${i}`,
    isContainer: true,
  }))
  const prs = Array.from({ length: count }, (_, i) => ({
    pullRequestId: i + 1,
    title: `Fixture PR ${String(i + 1).padStart(5, '0')}`,
    description: i % 10 === 0 ? 'd'.repeat(400) : `Searchable fixture description ${i + 1}`,
    createdBy: {
      id: `author-${i % 12}`,
      displayName: `Author ${i % 12}`,
      descriptor: i % 7 === 0 ? 'svc.fixture' : 'aad.fixture',
    },
    creationDate: new Date(Date.UTC(2026, 0, 1) + i * 60000),
    isDraft: i % 5 === 0,
    sourceRefName: `refs/heads/feature-${i + 1}`,
    targetRefName: i % 3 === 0 ? 'refs/heads/develop' : 'refs/heads/main',
    reviewers: [
      { id: 'profile-me', displayName: 'Fixture user', isRequired: true, vote: i % 4 === 0 ? 10 : 0 },
      { ...groups[i % groups.length], displayName: `Team ${i % groups.length}`, vote: 0 },
    ],
    repository: { id: `repo-${i % 8}`, name: `Repository ${i % 8}`, project: { id: 'fixture' } },
    _links: { self: { href: `https://profile.invalid/_apis/git/repositories/repo/pullRequests/${i + 1}` } },
  }))
  let mode = 'healthy'
  let active = 0
  let requests = 0
  let maxConcurrency = 0
  const byKind = {}
  async function request(kind, result) {
    requests++
    maxConcurrency = Math.max(maxConcurrency, ++active)
    const stats = (byKind[kind] ??= { count: 0, active: 0, maxConcurrency: 0 })
    stats.count++
    stats.maxConcurrency = Math.max(stats.maxConcurrency, ++stats.active)
    const current = mode
    try {
      await new Promise((resolve) => setTimeout(resolve, current === 'slow' ? 25 : delayMs))
      if (current === 'offline') throw Object.assign(new Error('Fixture offline'), { code: 'ENETUNREACH' })
      if (current === 'failing' && (kind === 'list' || kind === 'policy'))
        throw Object.assign(new Error('Fixture 503'), { statusCode: 503 })
      return result()
    } finally {
      active--
      stats.active--
    }
  }
  return {
    groups,
    setMode(value) {
      if (!['healthy', 'slow', 'offline', 'failing'].includes(value)) throw new Error('Invalid fixture mode')
      mode = value
    },
    stats: () => structuredClone({ requests, active, maxConcurrency, byKind }),
    api: {
      connect: () =>
        request('connect', () => ({ authenticatedUser: { id: 'profile-me', providerDisplayName: 'Fixture user' } })),
      getLocationsApi: async () => ({
        getResourceArea: () => request('location', () => ({ locationUrl: 'https://profile.invalid/' })),
      }),
      rest: {
        get: (address) =>
          request('identity', () => {
            const url = new URL(address)
            if (url.origin !== 'https://profile.invalid') throw new Error('Unexpected fixture URL')
            if (url.searchParams.has('identityIds'))
              return { result: { value: [{ memberOf: groups.map((group) => group.descriptor) }] } }
            const descriptors = url.searchParams.get('descriptors').split(',')
            if (descriptors.length > 20) throw new Error('Identity batches must contain at most 20 descriptors')
            return { result: { value: groups.filter((group) => descriptors.includes(group.descriptor)) } }
          }),
      },
      getGitApi: async () => ({
        getPullRequestsByProject: () => request('list', () => structuredClone(prs)),
        getPullRequest: (_repo, id) =>
          request('description', () => ({ description: `Full description for PR ${id}. ${'d'.repeat(450)}` })),
      }),
      getPolicyApi: async () => ({ getPolicyEvaluations: () => request('policy', () => []) }),
    },
  }
}

export function summarizeSamples(samples) {
  if (!samples.length) throw new Error('Resource samples are required')
  return {
    rssPeakMiB: Math.max(...samples.map((sample) => sample.rssMiB)),
    cpuMeanPercent: samples.reduce((sum, sample) => sum + sample.cpuPercent, 0) / samples.length,
    samples: samples.length,
  }
}

export function evaluateBudgets(measurements, budgets) {
  return Object.entries(budgets).map(([metric, limit]) => ({
    metric,
    value: measurements[metric] ?? null,
    limit,
    passed: Number.isFinite(measurements[metric]) && measurements[metric] <= limit,
  }))
}
