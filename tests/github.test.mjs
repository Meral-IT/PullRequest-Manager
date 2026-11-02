import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, isAbsolute, win32 } from 'node:path'
import { runInThisContext } from 'node:vm'
import test from 'node:test'
import { build } from 'rolldown'

const entry = resolve('tests/github-entry.ts')
const { output } = await build({
  input: entry,
  plugins: [
    {
      name: 'entry',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `
      export { GitHubService } from '../lib/github/github.service'
      export { IntegrationsService } from '../lib/integrations/integrations.service'
      export { pullRequestKey } from '../lib/models/pull-request.model'
      export { FilterEvaluator } from '../lib/models/ui-filter.model'
      export { defaultProfiles } from '../lib/models/pr-profile'
    `
          : undefined,
    },
  ],
  platform: 'node',
  output: { format: 'cjs' },
  write: false,
  external: (id) =>
    (!id.startsWith('.') && !isAbsolute(id) && !win32.isAbsolute(id)) ||
    id.endsWith('/main/notification.service') ||
    id.endsWith('/tools/loading.service'),
})
const module = { exports: {} }
const require = createRequire(import.meta.url)
runInThisContext(`(function(require,module,exports){${output[0].code}\n})`)(
  (name) => {
    if (name === 'electron') return { BrowserWindow: { getAllWindows: () => [] } }
    if (name === 'electron-log/main')
      return {
        error() {
          return undefined
        },
        debug() {
          return undefined
        },
      }
    if (name.endsWith('/notification.service'))
      return {
        NotificationService: {
          getInstance: () => ({
            notifyNewPullRequests() {
              return undefined
            },
          }),
        },
      }
    if (name.endsWith('/loading.service'))
      return {
        start() {
          return undefined
        },
        stop() {
          return undefined
        },
      }
    return require(name)
  },
  module,
  module.exports
)
const { GitHubService, IntegrationsService, pullRequestKey, FilterEvaluator, defaultProfiles } = module.exports
const settings = {
  type: 'github',
  id: 'github',
  name: 'GitHub',
  repositories: ['acme/widget'],
  pat: 'private-token',
  updateInterval: 180,
  intelligentApproval: true,
}
const me = { id: 7, login: 'me', type: 'User' }
const repo = { id: 20, name: 'widget', full_name: 'acme/widget', owner: { id: 10, login: 'acme' } }
function pr(number = 1) {
  return {
    number,
    title: `PR ${number}`,
    body: 'Description',
    user: { id: 8, login: 'author', type: 'Bot' },
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    draft: false,
    state: 'open',
    html_url: `https://github.com/acme/widget/pull/${number}`,
    base: { ref: 'main', repo },
    head: { ref: 'feature', sha: 'head-1' },
    mergeable: null,
  }
}
function fixture(t, overrides = {}) {
  const calls = []
  const routes = {
    '/user': me,
    '/user/teams': [{ id: 30, name: 'Reviewers', slug: 'reviewers', organization: { login: 'acme' } }],
    '/repos/acme/widget': repo,
    '/repos/acme/widget/pulls': [pr()],
    '/repos/acme/widget/pulls/1': pr(),
    '/repos/acme/widget/pulls/1/reviews': [],
    '/repos/acme/widget/pulls/1/requested_reviewers': {
      users: [],
      teams: [{ id: 30, name: 'Reviewers', slug: 'reviewers' }],
    },
    '/repos/acme/widget/commits/head-1/check-runs': {
      check_runs: [{ id: 50, name: 'Build', status: 'in_progress', conclusion: null }],
    },
    '/repos/acme/widget/commits/head-1/status': {
      statuses: [{ id: 60, context: 'Lint', state: 'failure', target_url: 'https://github.com/check' }],
    },
    ...overrides,
  }
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input)
    assert.equal(url.origin, 'https://api.github.com')
    calls.push({ url, ...init })
    const handler = routes[`${init.method ?? 'GET'} ${url.pathname}`] ?? routes[url.pathname]
    assert.notEqual(handler, undefined, `Unexpected ${init.method ?? 'GET'} ${url}`)
    const value = typeof handler === 'function' ? await handler(url, init) : handler
    return value instanceof Response ? value : Response.json(value)
  })
  const service = new GitHubService(() => {})
  service.setConfiguration(settings)
  t.after(() => {
    service.stop()
    GitHubService.requestSchedules.clear()
  })
  return { service, calls, routes }
}

test('GitHub maps repositories, verified teams, review decisions and unavailable versus pending checks', async (t) => {
  const { service, calls } = fixture(t)
  await service.updateDataImmediately()
  const data = service.getPullRequests()
  assert.equal(data.error, null)
  const item = data.items[0]
  assert.equal(item.provider, 'github')
  assert.equal(item.details.organization, 'acme')
  assert.equal(item.details.project, 'widget')
  assert.equal(item.details.repositoryId, '20')
  assert.equal(item.author.isBot, true)
  assert.equal(item.reviewers[0].user.isMySelf, true)
  assert.equal(item.reviewers[0].vote, 0)
  assert.equal(item.details.isConflict, false)
  assert.equal(item.headCommitId, 'head-1')
  assert.deepEqual(
    item.evaluations.map((check) => check.status),
    [1, 3]
  )
  assert.equal(
    FilterEvaluator.evaluate([item], defaultProfiles.find((profile) => profile.id === 'todo').filter).length,
    1
  )
  assert.equal(calls[0].headers.Authorization, 'Bearer private-token')
  assert.equal(calls[0].headers['X-GitHub-Api-Version'], '2026-03-10')
  assert.notEqual(pullRequestKey(item), pullRequestKey({ ...item, provider: 'azure-devops' }))
})

test('all PR and review pages are read and comment/dismissed reviews do not erase active decisions', async (t) => {
  const { service } = fixture(t, {
    '/repos/acme/widget/pulls': (url) =>
      url.searchParams.get('page') === '2'
        ? []
        : new Response(JSON.stringify([pr()]), {
            headers: { Link: '<https://api.github.com/repos/acme/widget/pulls?page=2>; rel="next"' },
          }),
    '/repos/acme/widget/pulls/1/reviews': (url) =>
      url.searchParams.get('page') === '2'
        ? [
            { id: 3, user: me, state: 'COMMENTED' },
            { id: 4, user: me, state: 'DISMISSED' },
          ]
        : new Response(
            JSON.stringify([
              { id: 1, user: me, state: 'CHANGES_REQUESTED' },
              { id: 2, user: me, state: 'APPROVED' },
            ]),
            { headers: { Link: '<https://api.github.com/repos/acme/widget/pulls/1/reviews?page=2>; rel="next"' } }
          ),
  })
  await service.updateDataImmediately()
  const item = service.getPullRequests().items[0]
  assert.equal(item.reviewers.find((reviewer) => reviewer.user.id === '7').vote, 10)
  assert.equal(item.canApprove, false)
  assert.equal(item.canResetFeedback, true)
})

test('optional access failures keep PRs visible and never mark missing data as passing', async (t) => {
  const { service } = fixture(t, {
    '/user/teams': new Response(null, { status: 403 }),
    '/repos/acme/widget/pulls/1/reviews': new Response(null, { status: 403 }),
    '/repos/acme/widget/commits/head-1/check-runs': new Response(null, { status: 403 }),
  })
  await service.updateDataImmediately()
  const data = service.getPullRequests()
  assert.equal(data.items.length, 1)
  assert.equal(data.items[0].checksUnavailable, true)
  assert.equal(data.items[0].reviewersUnavailable, true)
  assert.equal(data.items[0].reviewers[0].user.isMySelf, false)
  assert.match(data.error.details, /acme\/widget/)
  assert.equal(JSON.stringify(data).includes('private-token'), false)
})

test('validation makes only reads, reports denied repositories and keeps healthy results', async (t) => {
  const { service, calls } = fixture(t, { '/repos/acme/denied': new Response(null, { status: 404 }) })
  service.setConfiguration({ ...settings, repositories: ['acme/denied', 'acme/widget'] })
  await service.updateDataImmediately()
  assert.equal(service.getPullRequests().items.length, 1)
  const result = await service.validateConnection(settings)
  assert.equal(result.userDisplayName, 'me')
  assert.equal(
    calls.every((call) => !call.method || call.method === 'GET'),
    true
  )
})

test('conditional GETs reuse cached pages and cross-origin pagination never receives credentials', async (t) => {
  let round = 0
  const { service, calls, routes } = fixture(t, {
    '/repos/acme/widget/pulls': (_url, init) =>
      ++round === 1
        ? new Response(JSON.stringify([pr()]), { headers: { ETag: '"one"' } })
        : (assert.equal(init.headers['If-None-Match'], '"one"'), new Response(null, { status: 304 })),
  })
  await service.updateDataImmediately()
  await service.updateDataImmediately()
  assert.equal(service.getPullRequests().items.length, 1)
  routes['/repos/acme/widget/pulls'] = new Response(JSON.stringify([]), {
    headers: { Link: '<https://attacker.invalid/page>; rel="next"' },
  })
  await service.updateDataImmediately()
  assert.ok(service.getPullRequests().error)
  assert.ok(calls.every((call) => call.url.hostname === 'api.github.com'))
})

test('rate limits back off subsequent calls and errors never leak credentials', async (t) => {
  const { service, calls } = fixture(t, {
    '/user': new Response('private-token', { status: 429, headers: { 'Retry-After': '60' } }),
  })
  await service.updateDataImmediately()
  const before = calls.length
  await service.updateDataImmediately()
  assert.equal(calls.length, before)
  assert.match(service.getPullRequests().error.details, /rate limit/i)
  assert.equal(JSON.stringify(service.getPullRequests()).includes('private-token'), false)
})

test('stopping during refresh discards late results and incomplete configuration makes no requests', async (t) => {
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const { service, calls } = fixture(t, {
    '/user': async () => {
      await pending
      return me
    },
  })
  const refresh = service.updateDataImmediately()
  await new Promise((resolve) => setImmediate(resolve))
  service.stop()
  release()
  await refresh
  assert.equal(service.getPullRequests().items.length, 0)
  service.setConfiguration({ ...settings, repositories: ['../bad'] })
  const before = calls.length
  await service.updateDataImmediately()
  assert.equal(calls.length, before)
})

test('approval binds the displayed commit and dismissal touches only own active decisive reviews', async (t) => {
  const { service, calls, routes } = fixture(t, {
    '/repos/acme/widget/pulls/1/reviews': [
      { id: 1, user: me, state: 'CHANGES_REQUESTED' },
      { id: 2, user: { id: 9, login: 'other' }, state: 'APPROVED' },
    ],
    'POST /repos/acme/widget/pulls/1/reviews': { id: 3, user: me, state: 'APPROVED' },
    'PUT /repos/acme/widget/pulls/1/reviews/1/dismissals': {},
  })
  await service.updateDataImmediately()
  const item = service.getPullRequests().items[0]
  await service.approvePullRequests([item])
  const approval = calls.find((call) => call.method === 'POST')
  assert.deepEqual(JSON.parse(approval.body), { event: 'APPROVE', commit_id: 'head-1' })
  await service.resetPullRequestFeedback(item)
  const dismissals = calls.filter((call) => call.method === 'PUT')
  assert.equal(dismissals.length, 1)
  assert.equal(JSON.parse(dismissals[0].body).message, 'Review reset via PullRequest-Manager.')
  routes['/repos/acme/widget/pulls/1'] = { ...pr(), head: { ...pr().head, sha: 'changed' } }
  await assert.rejects(service.approvePullRequests([item]), /changed|refresh/i)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
})

test('manager deduplicates within a provider and ignores forged action routing while preserving selected commits', async () => {
  const manager = new IntegrationsService()
  manager.setConfiguration([
    {
      type: 'azure-devops',
      id: 'azure',
      name: 'Azure',
      organizationUrl: '',
      project: '',
      pat: '',
      updateInterval: 180,
      intelligentApproval: true,
    },
    settings,
    { ...settings, id: 'overlap' },
  ])
  const github = {
    id: 1,
    provider: 'github',
    headCommitId: 'current',
    creationDate: new Date(),
    details: { organizationId: '10', repositoryId: '20' },
    urls: { web: 'https://github.com/acme/widget/pull/1' },
  }
  const azure = { ...github, provider: 'azure-devops' }
  const approved = []
  for (const [id, entry] of manager.services) {
    entry.service.getPullRequests = () => ({ items: [id === 'azure' ? azure : github], error: null })
    entry.service.approvePullRequests = async (items) => approved.push([id, items])
  }
  assert.equal(manager.getPullRequests().items.length, 2)
  const displayed = manager.getPullRequests().items.find((item) => item.provider === 'github')
  await assert.rejects(manager.approvePullRequests([{ ...displayed, integrationId: 'azure' }]), /connection changed/i)
  assert.equal(approved.length, 0)
  await manager.approvePullRequests([{ ...displayed, headCommitId: 'displayed' }])
  assert.equal(approved.length, 1)
  assert.equal(approved[0][0], 'github')
  assert.equal(approved[0][1][0].headCommitId, 'displayed')
  manager.stop()
})

test('saved connection validation shares polling work and respects its rate limit cooldown', async (t) => {
  const { service, calls } = fixture(t, {
    '/user': new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
  })
  await service.updateDataImmediately()
  const count = calls.length
  await service.validateConnection(settings)
  assert.equal(calls.length, count)
})

test('same-origin redirects are followed without forwarding credentials outside GitHub', async (t) => {
  const { service } = fixture(t, {
    '/repos/acme/widget': new Response(null, {
      status: 301,
      headers: { Location: 'https://api.github.com/repositories/20' },
    }),
    '/repositories/20': repo,
  })
  await service.updateDataImmediately()
  assert.equal(service.getPullRequests().items.length, 1)
})

test('approval rechecks reviews so an external approval is not submitted twice', async (t) => {
  const { service, calls, routes } = fixture(t)
  await service.updateDataImmediately()
  const item = service.getPullRequests().items[0]
  routes['/repos/acme/widget/pulls/1/reviews'] = [{ id: 5, user: me, state: 'APPROVED' }]
  await service.approvePullRequests([item])
  assert.equal(
    calls.some((call) => call.method === 'POST'),
    false
  )
})

test('bulk approval preserves a later success after a denial and spaces review writes', async (t) => {
  const { service, calls } = fixture(t, {
    '/repos/acme/widget/pulls': [pr(), pr(2)],
    '/repos/acme/widget/pulls/2': pr(2),
    '/repos/acme/widget/pulls/2/reviews': [],
    '/repos/acme/widget/pulls/2/requested_reviewers': { users: [me], teams: [] },
    'POST /repos/acme/widget/pulls/1/reviews': new Response(null, { status: 403 }),
    'POST /repos/acme/widget/pulls/2/reviews': {},
  })
  const times = []
  const fetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (...args) => {
    if (args[1]?.method === 'POST') times.push(Date.now())
    return fetch(...args)
  })
  await service.updateDataImmediately()
  await assert.rejects(service.approvePullRequests(service.getPullRequests().items), /access denied/i)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 2)
  assert.ok(times[1] - times[0] >= 990)
  assert.equal(service.getPullRequests().access.features.approval.status, 'denied')
})

test('own PRs and reviews requested exclusively from somebody else are not approved', async (t) => {
  const { service, calls, routes } = fixture(t, {
    '/repos/acme/widget/pulls/1': { ...pr(), user: me },
  })
  await service.updateDataImmediately()
  await service.approvePullRequests(service.getPullRequests().items)
  routes['/repos/acme/widget/pulls/1'] = pr()
  routes['/repos/acme/widget/pulls/1/requested_reviewers'] = { users: [{ id: 9, login: 'other' }], teams: [] }
  await service.updateDataImmediately()
  await service.approvePullRequests(service.getPullRequests().items)
  assert.equal(
    calls.some((call) => call.method === 'POST'),
    false
  )
})

test('network timeouts remain visible and overlapping refreshes share one request', async (t) => {
  const { service, calls } = fixture(t, {
    '/user': async () => {
      throw new DOMException('private-token', 'TimeoutError')
    },
  })
  await Promise.all([service.updateDataImmediately(), service.updateDataImmediately()])
  assert.equal(calls.length, 1)
  assert.match(service.getPullRequests().error.details, /timed out/i)
  assert.equal(JSON.stringify(service.getPullRequests()).includes('private-token'), false)
})

test('a replacement connection never publishes an old repository response', async (t) => {
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const { service, routes } = fixture(t, {
    '/user': async () => {
      await pending
      return me
    },
  })
  const first = service.updateDataImmediately()
  await new Promise((resolve) => setImmediate(resolve))
  service.setConfiguration({ ...settings, repositories: [] })
  routes['/user'] = me
  const second = service.updateDataImmediately()
  release()
  await Promise.all([first, second])
  assert.equal(service.getPullRequests().items.length, 0)
  assert.match(service.getPullRequests().error.details, /owner\/repository/)
})

test('a connection change during action refresh cannot publish the old action error', async (t) => {
  const { service, routes } = fixture(t, {
    'POST /repos/acme/widget/pulls/1/reviews': new Response(null, { status: 403 }),
  })
  await service.updateDataImmediately()
  const item = service.getPullRequests().items[0]
  routes['/user'] = () => {
    service.setConfiguration({ ...settings, pat: 'replacement' })
    return me
  }
  await assert.doesNotReject(service.approvePullRequests([item]))
  assert.equal(service.getPullRequests().error, null)
})

test('secondary rate limits without retry headers still pause subsequent requests', async (t) => {
  const { service, calls } = fixture(t, {
    '/user': Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 }),
  })
  await service.updateDataImmediately()
  await service.updateDataImmediately()
  assert.equal(calls.length, 1)
  assert.match(service.getPullRequests().error.details, /rate limit/i)
})

test('renamed repository metadata still routes reviews through its configured repository', async (t) => {
  const { service, calls } = fixture(t, {
    '/repos/acme/widget': {
      ...repo,
      name: 'renamed',
      full_name: 'new-owner/renamed',
      owner: { id: 10, login: 'new-owner' },
    },
    'POST /repos/acme/widget/pulls/1/reviews': {},
  })
  await service.updateDataImmediately()
  await assert.doesNotReject(service.approvePullRequests(service.getPullRequests().items))
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
})

test('stale displayed connections cannot approve or dismiss after failover, removal, or PAT replacement', async () => {
  for (const change of ['failover', 'removal', 'pat replacement']) {
    const manager = new IntegrationsService()
    const configs = [settings, { ...settings, id: 'overlap' }]
    manager.setConfiguration(configs)
    const row = {
      id: 1,
      provider: 'github',
      headCommitId: 'head',
      creationDate: new Date(),
      details: { organizationId: '10', repositoryId: '20' },
      urls: { web: 'https://github.com/acme/widget/pull/1' },
    }
    const actions = []
    for (const [id, entry] of manager.services) {
      entry.service.getPullRequests = () => ({ items: [row], error: null })
      entry.service.approvePullRequests = async () => actions.push(['approve', id])
      entry.service.resetPullRequestFeedback = async () => actions.push(['dismiss', id])
    }
    const displayed = manager.getPullRequests().items[0]
    if (change === 'failover')
      manager.services.get('github').service.getPullRequests = () => ({ items: [], error: null })
    if (change === 'removal') manager.setConfiguration(configs.slice(1))
    if (change === 'pat replacement') manager.setConfiguration([{ ...settings, pat: 'replacement' }, configs[1]])
    await assert.rejects(manager.approvePullRequests([displayed]), /connection changed|refresh/i, change)
    await assert.rejects(manager.resetPullRequestFeedback(displayed), /connection changed|refresh/i, change)
    assert.deepEqual(actions, [], change)
    const current = manager.getPullRequests().items[0]
    await manager.approvePullRequests([current])
    await manager.resetPullRequestFeedback(current)
    assert.equal(actions.length, 2)
    manager.stop()
  }
})

function twoConnections(t, overrides = {}) {
  const setup = fixture(t, overrides)
  const secondRepo = { ...repo, id: 21, name: 'second', full_name: 'acme/second' }
  for (const [resource, handler] of Object.entries(setup.routes)) {
    if (resource.startsWith('/repos/acme/widget/'))
      setup.routes[resource.replace('/repos/acme/widget/', '/repos/acme/second/')] = handler
  }
  setup.routes['/repos/acme/second'] = secondRepo
  const manager = new IntegrationsService()
  manager.setConfiguration([settings, { ...settings, id: 'second', repositories: ['acme/second'] }])
  t.after(() => manager.stop())
  return { ...setup, manager }
}

test('connections sharing a PAT serialize API traffic and space manager bulk review writes', async (t) => {
  const { manager, calls, routes } = twoConnections(t)
  const times = []
  routes['POST /repos/acme/widget/pulls/1/reviews'] = () => {
    times.push(Date.now())
    return {}
  }
  routes['POST /repos/acme/second/pulls/1/reviews'] = () => {
    times.push(Date.now())
    return {}
  }
  let active = 0
  let maximum = 0
  const fetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (...args) => {
    maximum = Math.max(maximum, ++active)
    await new Promise((resolve) => setImmediate(resolve))
    try {
      return await fetch(...args)
    } finally {
      active--
    }
  })
  await manager.updateDataImmediately()
  assert.equal(manager.getPullRequests().items.length, 2)
  await manager.approvePullRequests(manager.getPullRequests().items)
  assert.equal(maximum, 1)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 2)
  assert.ok(times[1] - times[0] >= 990)
})

test('a PAT cooldown applies to another connection using the same credentials', async (t) => {
  const { manager, calls } = twoConnections(t, {
    '/user': new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
  })
  await manager.services.get('github').service.updateDataImmediately()
  await manager.services.get('second').service.updateDataImmediately()
  assert.equal(calls.length, 1)
  assert.match(manager.services.get('second').service.getPullRequests().error.details, /rate limit/i)
})
