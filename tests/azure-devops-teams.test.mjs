import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInThisContext } from 'node:vm'
import { build } from 'rolldown'

const __dirname = dirname(fileURLToPath(import.meta.url))
const load = createRequire(import.meta.url)
const entry = resolve(__dirname, 'azure-devops-teams-entry.ts')
const { output } = await build({
  input: entry,
  plugins: [{
    name: 'test-entry',
    resolveId: (id) => id === entry ? entry : undefined,
    load: (id) => id === entry ? `
      export { AzureDevOpsService } from '../lib/azure-devops/azure-devops.service'
      export { FilterEvaluator } from '../lib/models/ui-filter.model'
      export { defaultProfiles } from '../lib/models/pr-profile'
    ` : undefined,
  }],
  platform: 'node',
  output: { format: 'cjs' },
  external: (id) => (!id.startsWith('.') && !id.startsWith('/')) ||
    id === '../main/notification.service' || id === '../tools/loading.service',
  write: false,
})
const compiled = { exports: {} }
runInThisContext(`(function(require, module, exports) { ${output[0].code}\n})`)(
  (name) => {
    if (name === 'electron') {
      return { BrowserWindow: { getAllWindows: () => [{ webContents: { send: () => undefined } }] } }
    }
    if (name === 'electron-log/main') return { debug: () => undefined, error: () => undefined }
    if (name === '../lib/main/notification.service' || name === '../lib/tools/loading.service') return {}
    return load(name)
  },
  compiled,
  compiled.exports
)
const { AzureDevOpsService, FilterEvaluator, defaultProfiles } = compiled.exports

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
