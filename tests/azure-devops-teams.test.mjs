import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve, win32 } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'
import { build } from 'rolldown'

const __dirname = dirname(fileURLToPath(import.meta.url))
const load = createRequire(import.meta.url)
const isExternal = (id) =>
  (!id.startsWith('.') && !isAbsolute(id) && !win32.isAbsolute(id)) ||
  id === '../main/notification.service' ||
  id === '../tools/loading.service'

test('test loader bundles Windows, POSIX, and relative paths while keeping packages and mocks external', () => {
  for (const id of [
    'D:/a/project/service.ts',
    'D:\\a\\project\\service.ts',
    '/project/service.ts',
    '../models/pr-vote.ts',
  ]) {
    assert.equal(isExternal(id), false, id)
  }
  for (const id of ['azure-devops-node-api', '../main/notification.service', '../tools/loading.service']) {
    assert.equal(isExternal(id), true, id)
  }
})
const entry = resolve(__dirname, 'azure-devops-teams-entry.ts')
const { output } = await build({
  input: entry,
  plugins: [
    {
      name: 'test-entry',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `
      export { AzureDevOpsService } from '../lib/azure-devops/azure-devops.service'
      export { AzureDevOpsIntegrationsService } from '../lib/azure-devops/azure-devops-integrations.service'
      export { FilterEvaluator } from '../lib/models/ui-filter.model'
      export { defaultProfiles } from '../lib/models/pr-profile'
      export * from '../lib/models/azure-devops-access'
    `
          : undefined,
    },
  ],
  platform: 'node',
  output: { format: 'cjs' },
  external: isExternal,
  write: false,
})
const compiled = { exports: {} }
const loading = {
  active: 0,
  start() {
    this.active++
  },
  stop() {
    this.active--
  },
}
runInThisContext(`(function(require, module, exports) { ${output[0].code}\n})`)(
  (name) => {
    if (name === 'electron') {
      return { BrowserWindow: { getAllWindows: () => [{ webContents: { send: () => undefined } }] } }
    }
    if (name === 'electron-log/main') return { debug: () => undefined, error: () => undefined }
    if (name === '../lib/main/notification.service')
      return { NotificationService: { getInstance: () => ({ notifyNewPullRequests: () => {} }) } }
    if (name === '../lib/tools/loading.service') return loading
    return load(name)
  },
  compiled,
  compiled.exports
)
const { AzureDevOpsService, AzureDevOpsIntegrationsService, FilterEvaluator, defaultProfiles } = compiled.exports

const settings = {
  organizationUrl: 'https://dev.azure.com/example',
  project: 'project',
  pat: 'test-token',
  intelligentApproval: true,
}
const me = { id: 'me' }
const team1 = { id: 'team-1', descriptor: 'Microsoft.TeamFoundation.Identity;team-1', isContainer: true }
const team2 = { id: 'team-2', descriptor: 'Microsoft.TeamFoundation.Identity;team-2', isContainer: true }

function pullRequest(id, reviewerId, authorId = 'other') {
  return {
    pullRequestId: id,
    isDraft: false,
    createdBy: { id: authorId },
    reviewers: [{ id: reviewerId, isRequired: true, vote: 0 }],
    repository: { id: 'repo', project: { id: 'project' } },
    _links: { self: { href: `https://dev.azure.com/example/_apis/git/repositories/repo/pullRequests/${id}` } },
  }
}

function apiFixture({ memberships = [team1.descriptor, team2.descriptor], prs = [], groups = [team1, team2] } = {}) {
  const identities = new Map(groups.map((team) => [team.descriptor, team]))
  const approved = []
  return {
    approved,
    connect: async () => ({ authenticatedUser: me }),
    getCoreApi: async () => ({ getTeams: async () => [team1] }),
    getLocationsApi: async () => ({
      getResourceArea: async (id) => {
        assert.equal(id, '8a3d49b8-91f0-46ef-b33d-dda338c25db3')
        return { locationUrl: 'https://vssps.dev.azure.com/example/' }
      },
    }),
    rest: {
      get: async (address) => {
        const url = new URL(address)
        assert.equal(url.origin, 'https://vssps.dev.azure.com')
        assert.equal(url.pathname, '/example/_apis/identities')
        assert.equal(url.searchParams.get('api-version'), '7.1')
        if (url.searchParams.has('identityIds')) {
          assert.equal(url.searchParams.get('identityIds'), me.id)
          const memberOf = url.searchParams.get('queryMembership') === 'ExpandedUp' ? memberships : [team1.descriptor]
          return { result: { value: [{ ...me, memberOf }] } }
        }
        const descriptors = url.searchParams.get('descriptors').split(',')
        assert.ok(descriptors.length <= 20, 'Keep descriptor query URLs bounded')
        return { result: { value: descriptors.map((descriptor) => identities.get(descriptor)).filter(Boolean) } }
      },
    },
    getGitApi: async () => ({
      getPullRequestsByProject: async () => prs,
      createPullRequestReviewer: async (_reviewer, _repo, id) => {
        approved.push(id)
        return { ...me, vote: 10 }
      },
    }),
    getPolicyApi: async () => ({ getPolicyEvaluations: async () => [] }),
  }
}

test('API duplicates are consolidated and organization/project metadata is preserved', async () => {
  const pr = pullRequest(1, me.id)
  pr.repository.project.name = 'Platform'
  const api = apiFixture({ prs: [pr, structuredClone(pr)] })
  api.connect = async () => ({ authenticatedUser: me, instanceId: 'org-1' })
  const data = await AzureDevOpsService.loadPullRequestData(api, settings)
  assert.equal(data.items.length, 1)
  assert.equal(data.items[0].details.organization, 'example')
  assert.equal(data.items[0].details.organizationId, 'org-1')
  assert.equal(data.items[0].details.project, 'Platform')
})

test('integrations consolidate overlapping PRs, preserve cross-organization IDs, and route votes once', async () => {
  const manager = new AzureDevOpsIntegrationsService()
  const integrations = ['first', 'overlap', 'other-org'].map((id) => ({
    ...settings,
    id,
    name: id,
    updateInterval: 180,
    intelligentApproval: false,
    organizationUrl: `https://dev.azure.com/${id === 'other-org' ? 'other' : 'example'}`,
  }))
  manager.setConfiguration(integrations)
  const apis = integrations.map((integration, index) => {
    const pr = pullRequest(7, me.id)
    const api = apiFixture({ prs: [pr] })
    api.connect = async () => ({ authenticatedUser: me, instanceId: index === 2 ? 'org-2' : 'org-1' })
    manager.services.get(integration.id).service.initializeApi = () => api
    manager.services.get(integration.id).service.reInitializeApi()
    return api
  })
  await manager.updateDataImmediately()
  const data = manager.getPullRequests()
  assert.equal(data.items.length, 2)
  assert.deepEqual(
    data.items.map((pr) => pr.integrationId),
    ['first', 'other-org']
  )
  assert.equal(data.integrations.length, 3)
  await manager.approvePullRequests([...data.items, ...data.items])
  assert.deepEqual(
    apis.map((api) => api.approved),
    [[7], [], [7]]
  )
  await manager.resetPullRequestFeedback(data.items[1])
  assert.deepEqual(
    apis.map((api) => api.approved),
    [[7], [], [7, 7]]
  )
  assert.equal(manager.getPullRequests().items[0].reviewers[0].vote, 10)
  manager.setConfiguration(integrations.slice(1))
  assert.deepEqual(
    manager.getPullRequests().items.map((pr) => pr.integrationId),
    ['overlap', 'other-org']
  )
})

test('one failing integration leaves other results available and reports its own access status', async () => {
  const manager = new AzureDevOpsIntegrationsService()
  manager.setConfiguration(['healthy', 'expired'].map((id) => ({ ...settings, id, name: id, updateInterval: 180 })))
  for (const [id, { service }] of manager.services) {
    const api = apiFixture({ prs: [pullRequest(1, me.id)] })
    if (id === 'expired')
      api.connect = async () => {
        throw Object.assign(new Error('Expired'), { statusCode: 401 })
      }
    service.initializeApi = () => api
    service.reInitializeApi()
  }
  await manager.updateDataImmediately()
  const data = manager.getPullRequests()
  assert.equal(data.error, null)
  assert.equal(data.items.length, 1)
  assert.equal(data.integrations[0].error, null)
  assert.equal(data.integrations[1].error.type, 'Authentication')
  const access = data.integrations[0].access
  assert.equal(
    manager.canAcknowledgeAccess(access.requirementsFingerprint, access.connectionRevision, 'unknown'),
    false
  )
  manager.acknowledgeAccess('healthy')
  assert.equal(manager.getPullRequests().integrations[0].access.acknowledged, true)
  assert.equal(manager.getPullRequests().integrations[1].access.acknowledged, false)
})

test('removing an integration during refresh discards its late results and stops polling', async () => {
  const manager = new AzureDevOpsIntegrationsService()
  manager.setConfiguration([{ ...settings, id: 'removed', name: 'Removed', updateInterval: 180 }])
  const service = manager.services.get('removed').service
  const api = apiFixture({ prs: [pullRequest(1, me.id)] })
  let release
  api.connect = () =>
    new Promise((resolve) => {
      release = resolve
    })
  service.initializeApi = () => api
  service.reInitializeApi()
  manager.start()
  manager.setConfiguration([])
  release({ authenticatedUser: me })
  await service.updateDataImmediately()
  assert.equal(service.active, false)
  assert.equal(service.pollTimer, undefined)
  assert.deepEqual(manager.getPullRequests().items, [])
  assert.deepEqual(manager.getPullRequests().integrations, [])
})

test('recreating an integration cannot accept an acknowledgement from its previous connection', () => {
  const manager = new AzureDevOpsIntegrationsService()
  const input = [{ ...settings, id: 'recreated', name: 'Connection', updateInterval: 180 }]
  manager.setConfiguration(input)
  const access = manager.getPullRequests().integrations[0].access
  assert.equal(
    manager.canAcknowledgeAccess(access.requirementsFingerprint, access.connectionRevision, 'recreated'),
    true
  )
  manager.setConfiguration([])
  manager.setConfiguration([{ ...input[0], pat: 'replacement-token' }])
  assert.equal(
    manager.canAcknowledgeAccess(access.requirementsFingerprint, access.connectionRevision, 'recreated'),
    false
  )
})

test('descriptions are mapped, with missing text defaulting to empty', async () => {
  const prs = [pullRequest(1, me.id), pullRequest(2, me.id)]
  prs[0].description = 'Searchable description'
  const data = await AzureDevOpsService.loadPullRequestData(apiFixture({ prs }), settings)
  assert.equal(data.error, null)
  assert.deepEqual(
    data.items.map((pr) => pr.details.description),
    ['Searchable description', '']
  )
})

test('potentially truncated descriptions are fetched in full with at most four requests at once', async () => {
  const prs = Array.from({ length: 10 }, (_, index) => ({
    ...pullRequest(index + 1, me.id),
    description: 'x'.repeat(index === 0 ? 399 : 400),
  }))
  const api = apiFixture({ prs })
  const git = await api.getGitApi()
  api.getGitApi = async () => git
  const lookups = []
  let active = 0
  let maximum = 0
  git.getPullRequest = async (repository, id, project) => {
    assert.equal(repository, 'repo')
    assert.equal(project, settings.project)
    lookups.push(id)
    maximum = Math.max(maximum, ++active)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    return { description: `${'x'.repeat(500)} final paragraph ${id}` }
  }
  const data = await AzureDevOpsService.loadPullRequestData(api, settings)
  assert.equal(data.error, null)
  assert.deepEqual(
    lookups.toSorted((a, b) => a - b),
    [2, 3, 4, 5, 6, 7, 8, 9, 10]
  )
  assert.equal(maximum, 4)
  assert.equal(data.items[0].details.description.length, 399)
  assert.equal(data.items[9].details.description, `${'x'.repeat(500)} final paragraph 10`)
})

test('full-description lookup failures use the existing refresh error state', async () => {
  const pr = { ...pullRequest(1, me.id), description: 'x'.repeat(400) }
  const api = apiFixture({ prs: [pr] })
  const git = await api.getGitApi()
  api.getGitApi = async () => git
  git.getPullRequest = async () => {
    throw Object.assign(new Error('Description lookup failed'), { statusCode: 403 })
  }
  const data = await AzureDevOpsService.loadPullRequestData(api, settings)
  assert.equal(data.error?.message, 'Description lookup failed')
  assert.equal(data.access.features.code.status, 'denied')
  assert.equal(data.access.features.identity.status, 'verified')
})

test('validation checks empty projects and memberships without casting votes', async () => {
  const api = apiFixture({ memberships: [] })
  const result = await AzureDevOpsService.validateAccess(api, settings)
  assert.equal(result.error, null)
  assert.equal(result.access.features.code.status, 'unverified')
  assert.match(result.access.features.code.message, /PR read access verified.*Policy access is not verified/)
  assert.equal(result.access.features.identity.status, 'verified')
  assert.equal(result.access.features.vote.status, 'unverified')
  assert.deepEqual(api.approved, [])
  assert.ok(!JSON.stringify(result).includes(settings.pat))
})

test('read checks run independently and distinguish scope/permission denial from bad project and outage', async () => {
  for (const [statusCode, status, reason] of [
    [403, 'denied', 'authorization'],
    [404, 'unverified', 'configuration'],
    [503, 'unverified', 'temporary'],
    [401, 'unverified', 'authentication'],
  ]) {
    const api = apiFixture()
    api.getGitApi = async () => ({
      getPullRequestsByProject: async () => {
        throw Object.assign(new Error(settings.pat), { statusCode })
      },
    })
    const result = await AzureDevOpsService.validateAccess(api, settings)
    assert.equal(result.error, null, 'Authentication is separate from feature access')
    assert.equal(result.access.features.code.status, status)
    assert.equal(result.access.features.code.reason, reason)
    assert.equal(result.access.features.identity.status, 'verified')
    assert.ok(!JSON.stringify(result).includes(settings.pat))
    if (statusCode === 403) assert.match(result.access.features.code.message, /PAT scopes.*Azure DevOps permissions/)
  }
})

test('invalid PATs and anonymous responses fail authentication without probing features', async () => {
  for (const anonymous of [true, false]) {
    const api = apiFixture()
    api.connect = async () => {
      if (anonymous) return {}
      throw Object.assign(new Error(settings.pat), { statusCode: 401 })
    }
    api.getGitApi = () => assert.fail('Do not probe without authentication')
    const result = await AzureDevOpsService.validateAccess(api, settings)
    assert.match(result.error, /authentication/i)
    assert.equal(result.access.features.code.reason, 'authentication')
    assert.ok(!JSON.stringify(result).includes(settings.pat))
  }
})

test('validation checks policy access when a sample PR is available', async () => {
  const api = apiFixture({ prs: [pullRequest(1, me.id)] })
  api.getPolicyApi = async () => ({
    getPolicyEvaluations: async () => {
      throw Object.assign(new Error('Policy access denied'), { statusCode: 403 })
    },
  })
  const result = await AzureDevOpsService.validateAccess(api, settings)
  assert.equal(result.error, null)
  assert.equal(result.access.features.code.status, 'denied')
})

test('a delayed vote preserves newer read denials and cannot modify a replacement connection', async () => {
  for (const changeConnection of [false, true]) {
    const api = apiFixture({ prs: [pullRequest(1, me.id)] })
    const service = new AzureDevOpsService()
    service.setConfiguration(settings)
    service.api = api
    await service.updateDataImmediately()
    let release
    const waiting = new Promise((resolve) => {
      release = resolve
    })
    api.getGitApi = async () => ({
      createPullRequestReviewer: async () => {
        await waiting
        return { ...me, vote: 10 }
      },
    })
    const approving = service.approvePullRequests(service.getPullRequests().items)
    await new Promise((resolve) => setImmediate(resolve))
    if (changeConnection) service.setConfiguration({ ...settings, pat: 'replacement-token' })
    else
      service.getPullRequests().access.features.code = {
        status: 'denied',
        reason: 'authorization',
        message: 'Read access denied',
      }
    release()
    await approving
    assert.equal(service.getPullRequests().access.features.code.status, changeConnection ? 'unverified' : 'denied')
  }
})

test('acknowledgement hides only unverified requirements and changes invalidate it', () => {
  const { createAzureDevOpsAccess, getAccessNoticeRequirements, AZURE_DEVOPS_REQUIREMENTS_FINGERPRINT } =
    compiled.exports
  const access = createAzureDevOpsAccess(AZURE_DEVOPS_REQUIREMENTS_FINGERPRINT)
  assert.equal(getAccessNoticeRequirements(access).length, 0)
  access.features.identity = { status: 'denied', reason: 'authorization', message: 'Check permissions' }
  assert.deepEqual(
    getAccessNoticeRequirements(access).map((r) => r.id),
    ['identity']
  )
  assert.equal(getAccessNoticeRequirements(createAzureDevOpsAccess('older-requirements')).length, 3)
})

test('votes record denied access, retain it during refresh, and verify only after a successful user action', async () => {
  const api = apiFixture({ prs: [pullRequest(1, me.id)] })
  const service = new AzureDevOpsService()
  service.setConfiguration(settings)
  service.api = api
  await service.updateDataImmediately()
  const [pr] = service.getPullRequests().items
  assert.equal(service.getPullRequests().access.features.vote.status, 'unverified')
  service.api = {
    ...api,
    getGitApi: async () => ({
      createPullRequestReviewer: async () => {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
      },
    }),
  }
  await service.approvePullRequests([pr])
  assert.equal(service.getPullRequests().access.features.vote.status, 'denied')
  service.acknowledgeAccess()
  assert.equal(compiled.exports.getAccessNoticeRequirements(service.getPullRequests().access).length, 1)
  service.api = api
  await service.updateDataImmediately()
  assert.equal(service.getPullRequests().access.features.vote.status, 'denied')
  await service.resetPullRequestFeedback(pr)
  assert.equal(service.getPullRequests().access.features.vote.status, 'verified')
})

test('changing credentials resets diagnostics and rejects stale acknowledgements and refresh results', async () => {
  const service = new AzureDevOpsService()
  service.setConfiguration(settings)
  const previous = service.getPullRequests().access
  const api = apiFixture()
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  api.connect = async () => {
    await waiting
    return { authenticatedUser: me }
  }
  service.api = api
  const refresh = service.updateDataImmediately()
  service.setConfiguration({
    ...settings,
    pat: 'replacement-token',
    acknowledgedScopeRequirements: compiled.exports.AZURE_DEVOPS_REQUIREMENTS_FINGERPRINT,
  })
  release()
  await refresh
  const access = service.getPullRequests().access
  assert.equal(access.features.code.status, 'unverified')
  assert.equal(access.acknowledged, false)
  assert.equal(service.canAcknowledgeAccess(previous.requirementsFingerprint, previous.connectionRevision), false)
})

test('a partially denied bulk approval cannot be hidden by a later successful vote', async () => {
  const api = apiFixture({ prs: [pullRequest(1, me.id), pullRequest(2, me.id)] })
  const service = new AzureDevOpsService()
  service.setConfiguration(settings)
  service.api = api
  await service.updateDataImmediately()
  api.getGitApi = async () => ({
    createPullRequestReviewer: async (_vote, _repo, id) => {
      if (id === 1) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
      return { ...me, vote: 10 }
    },
  })
  await service.approvePullRequests(service.getPullRequests().items)
  assert.equal(service.getPullRequests().access.features.vote.status, 'denied')
})

test('temporary read and vote failures cannot acknowledge away previously denied access', async () => {
  const api = apiFixture({ prs: [pullRequest(1, me.id)] })
  const service = new AzureDevOpsService()
  service.setConfiguration(settings)
  service.api = api
  await service.updateDataImmediately()
  const [pr] = service.getPullRequests().items
  service.getPullRequests().access.features.code = {
    status: 'denied',
    reason: 'authorization',
    message: 'Read access denied',
  }
  service.getPullRequests().access.features.vote = {
    status: 'denied',
    reason: 'authorization',
    message: 'Vote access denied',
  }
  service.acknowledgeAccess()
  api.getGitApi = async () => {
    throw Object.assign(new Error('Unavailable'), { statusCode: 503 })
  }
  await service.updateDataImmediately()
  await service.resetPullRequestFeedback(pr)
  assert.equal(service.getPullRequests().access.features.code.status, 'denied')
  assert.equal(service.getPullRequests().access.features.vote.status, 'denied')
  assert.equal(compiled.exports.getAccessNoticeRequirements(service.getPullRequests().access).length, 2)
  api.getGitApi = async () => ({ getPullRequestsByProject: async () => [pullRequest(1, me.id)] })
  api.getPolicyApi = async () => {
    throw Object.assign(new Error('Unavailable'), { statusCode: 503 })
  }
  await service.updateDataImmediately()
  assert.equal(
    service.getPullRequests().access.features.code.status,
    'denied',
    'PR reads cannot clear an unverified policy denial'
  )
})

test('nested team reviewers reach My Team, To do, and intelligent approval', async () => {
  const api = apiFixture({ prs: [pullRequest(1, team2.id), pullRequest(2, 'unrelated'), pullRequest(3, me.id, me.id)] })
  const data = await AzureDevOpsService.loadPullRequestData(api, settings)
  assert.equal(data.error, null)
  assert.equal(data.items[0].reviewers[0].user.isMySelf, true)
  assert.equal(data.items[1].reviewers[0].user.isMySelf, false)
  for (const profileId of ['my-team', 'todo']) {
    const profile = defaultProfiles.find((profile) => profile.id === profileId)
    assert.ok(FilterEvaluator.evaluate(data.items, profile.filter).some((pr) => pr.id === 1))
  }
  const own = defaultProfiles.find((profile) => profile.id === 'my')
  assert.deepEqual(
    FilterEvaluator.evaluate(data.items, own.filter).map((pr) => pr.id),
    [3]
  )

  const service = new AzureDevOpsService()
  service.settings = settings
  service.api = api
  service.data = data
  service.pullRequests = data
  await service.approvePullRequests(data.items)
  assert.deepEqual(api.approved, [1, 3])
})

test('expanded memberships also mark nested voted-for reviewers', async () => {
  const pr = pullRequest(1, 'required-group')
  pr.reviewers.push({ id: team2.id, vote: 10, votedFor: [{ id: 'required-group' }] })
  const data = await AzureDevOpsService.loadPullRequestData(apiFixture({ prs: [pr] }), settings)
  assert.equal(data.error, null)
  assert.equal(data.items[0].reviewers[0].reviewedBy[0].user.isMySelf, true)
})

test('duplicate parent memberships are resolved once and empty membership is safe', async () => {
  const api = apiFixture({ memberships: [team1.descriptor, team2.descriptor, team1.descriptor] })
  const teams = await AzureDevOpsService.loadMyTeams(api, settings, me)
  assert.deepEqual(
    teams.map((team) => team.id),
    [team1.id, team2.id]
  )
  const noTeams = apiFixture({ memberships: [] })
  assert.deepEqual(await AzureDevOpsService.loadMyTeams(noTeams, settings, me), [])
  noTeams.rest.get = () => assert.fail('Do not query identities without an authenticated user ID')
  assert.deepEqual(await AzureDevOpsService.loadMyTeams(noTeams, settings, undefined), [])
})

test('membership API failures remain visible instead of silently misclassifying reviewers', async () => {
  const api = apiFixture()
  api.rest.get = async () => {
    throw new Error('Identity read permission required')
  }
  const data = await AzureDevOpsService.loadPullRequestData(api, settings)
  assert.equal(data.error.message, 'Identity read permission required')
  assert.deepEqual(data.items, [])
})

test('large membership lists retain every parent without oversized descriptor queries', async () => {
  const groups = Array.from({ length: 41 }, (_, index) => ({
    id: `team-${index}`,
    descriptor: `Microsoft.TeamFoundation.Identity;team-${index}`,
  }))
  const memberships = groups.map((group) => group.descriptor)
  const teams = await AzureDevOpsService.loadMyTeams(apiFixture({ memberships, groups }), settings, me)
  assert.deepEqual(
    teams.map((team) => team.id),
    groups.map((group) => group.id)
  )
})

test('missing identity responses produce the existing visible error state', async () => {
  for (const failureAt of [1, 2]) {
    const api = apiFixture()
    const get = api.rest.get
    let calls = 0
    api.rest.get = (url) => (++calls === failureAt ? { result: null } : get(url))
    const data = await AzureDevOpsService.loadPullRequestData(api, settings)
    assert.ok(data.error)
    assert.deepEqual(data.items, [])
  }
  const api = apiFixture()
  api.getLocationsApi = async () => ({ getResourceArea: async () => ({}) })
  const data = await AzureDevOpsService.loadPullRequestData(api, settings)
  assert.ok(data.error)
  assert.deepEqual(data.items, [])
})

test('overlapping refreshes share one request and balance loading state', async () => {
  const service = new AzureDevOpsService()
  service.setConfiguration(settings)
  const api = apiFixture()
  const waiting = Promise.withResolvers()
  let calls = 0
  api.connect = async () => {
    calls++
    await waiting.promise
    return { authenticatedUser: me }
  }
  service.api = api
  const first = service.updateDataImmediately()
  const second = service.updateDataImmediately()
  const observed = { calls, loading: loading.active }
  waiting.resolve()
  await Promise.all([first, second])
  assert.deepEqual(observed, { calls: 1, loading: 1 })
  assert.equal(loading.active, 0)
})

test('connection replacements queue only the latest refresh behind running work', async () => {
  const service = new AzureDevOpsService()
  service.setConfiguration(settings)
  const waiting = Promise.withResolvers()
  let oldCalls = 0
  let replacementCalls = 0
  let currentCalls = 0
  const old = apiFixture()
  old.connect = async () => {
    oldCalls++
    await waiting.promise
    return { authenticatedUser: me }
  }
  service.api = old
  const first = service.updateDataImmediately()
  service.setConfiguration({ ...settings, project: 'replacement' })
  service.api = {
    ...apiFixture(),
    connect: async () => {
      replacementCalls++
      return { authenticatedUser: me }
    },
  }
  const second = service.updateDataImmediately()
  service.setConfiguration({ ...settings, project: 'latest' })
  service.api = {
    ...apiFixture(),
    connect: async () => {
      currentCalls++
      return { authenticatedUser: me }
    },
  }
  const third = service.updateDataImmediately()
  const queued = { replacementCalls, currentCalls }
  waiting.resolve()
  await Promise.all([first, second, third])
  assert.deepEqual(queued, { replacementCalls: 0, currentCalls: 0 })
  assert.equal(oldCalls, 1)
  assert.equal(replacementCalls, 0)
  assert.equal(currentCalls, 1)
  assert.equal(loading.active, 0)
})

test('refresh cleanup runs after publication throws and unconfigured refreshes do not stop another loader', async () => {
  const service = new AzureDevOpsService()
  const before = loading.active
  await service.updateDataImmediately()
  assert.equal(loading.active, before)
  service.setConfiguration(settings)
  service.api = apiFixture()
  service.publishData = () => {
    throw new Error('window closed')
  }
  await assert.rejects(service.updateDataImmediately(), /window closed/)
  assert.equal(loading.active, before)
  service.publishData = () => {}
  await service.updateDataImmediately()
  assert.equal(loading.active, before)
})

test('polling recovers from failure and stop/restart cannot leave duplicate loops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const service = new AzureDevOpsService()
  service.settings = { ...settings, updateInterval: 1 }
  service.reInitializeApi = () => {}
  let calls = 0
  service.updateDataImmediately = async () => {
    if (++calls === 1) throw new Error('temporary failure')
  }
  try {
    service.start()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 1)
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 2)
    service.stop()
    t.mock.timers.tick(5000)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 2)
    service.start()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 3)
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 4)
  } finally {
    service.stop()
  }
})

test('stopping and restarting during a refresh schedules one subsequent tick', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const service = new AzureDevOpsService()
  service.settings = { ...settings, updateInterval: 1 }
  service.reInitializeApi = () => {}
  const waiting = Promise.withResolvers()
  let calls = 0
  service.updateDataImmediately = async () => {
    calls++
    await waiting.promise
  }
  try {
    service.start()
    service.stop()
    service.start()
    waiting.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 2)
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 3)
  } finally {
    service.stop()
  }
})

test('large identity membership batches run concurrently with at most four requests', async () => {
  const groups = Array.from({ length: 201 }, (_, i) => ({ id: `team-${i}`, descriptor: `team-${i}` }))
  const api = apiFixture({ memberships: groups.map((group) => group.descriptor), groups })
  const get = api.rest.get
  let active = 0
  let maximum = 0
  api.rest.get = async (address) => {
    if (new URL(address).searchParams.has('identityIds')) return get(address)
    maximum = Math.max(maximum, ++active)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    return get(address)
  }
  const teams = await AzureDevOpsService.loadMyTeams(api, settings, me)
  assert.equal(maximum, 4)
  assert.deepEqual(
    teams.map((team) => team.id),
    groups.map((group) => group.id)
  )
})

test('policy enrichment attaches each response without per-result array searches', async () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, details: { projectId: 'project' } }))
  items.find = () => assert.fail('policy lookup must be linear')
  const api = apiFixture()
  api.getPolicyApi = async () => ({ getPolicyEvaluations: async (_project, artifact) => [{ evaluationId: artifact }] })
  await AzureDevOpsService.enrichPolicyEvaluations(api, settings, { items })
  assert.equal(items[999].evaluations[0].id, 'vstfs:///CodeReview/CodeReviewId/project/999')
})
