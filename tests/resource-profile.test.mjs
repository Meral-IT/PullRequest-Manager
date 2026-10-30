import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixture, fixtureSettings, summarizeSamples, evaluateBudgets } from '../scripts/profile/fixtures.mjs'

test('profile fixtures are deterministic, bounded and span multiple identity batches', async () => {
  for (const count of [0, 32, 1000, 10000]) {
    const fixture = createFixture({ count })
    assert.equal((await fixture.api.getGitApi()).getPullRequestsByProject instanceof Function, true)
    const prs = await (await fixture.api.getGitApi()).getPullRequestsByProject()
    assert.equal(prs.length, count)
    assert.equal(new Set(prs.map((pr) => pr.pullRequestId)).size, count)
    assert.equal(fixture.groups.length, 65)
    assert.equal(fixtureSettings.azDoIntegrations[0].pat, '')
    assert.equal(fixtureSettings.general.openAtLogin, false)
    assert.deepEqual(prs, await (await createFixture({ count }).api.getGitApi()).getPullRequestsByProject())
  }
  assert.throws(() => createFixture({ count: 10001 }), /fixture count/)
  const fixture = createFixture({ count: 32 })
  await assert.rejects(
    fixture.api.rest.get(
      `https://profile.invalid/_apis/identities?descriptors=${fixture.groups.map((g) => g.descriptor).join(',')}`
    ),
    /20/
  )
})

test('fixture outages and telemetry preserve completion and concurrent request counts', async () => {
  const fixture = createFixture({ count: 32, delayMs: 2 })
  await Promise.all(Array.from({ length: 4 }, () => fixture.api.connect()))
  assert.equal(fixture.stats().requests, 4)
  assert.equal(fixture.stats().maxConcurrency, 4)
  fixture.setMode('offline')
  await assert.rejects(fixture.api.connect(), /offline/)
  assert.equal(fixture.stats().active, 0)
  fixture.setMode('failing')
  await assert.rejects((await fixture.api.getGitApi()).getPullRequestsByProject(), /503/)
  fixture.setMode('healthy')
  assert.equal((await fixture.api.connect()).authenticatedUser.id, 'profile-me')
})

test('measurement summary and budgets reject missing data and report regressions', () => {
  assert.deepEqual(
    summarizeSamples([
      { rssMiB: 100, cpuPercent: 2 },
      { rssMiB: 200, cpuPercent: 6 },
    ]),
    {
      rssPeakMiB: 200,
      cpuMeanPercent: 4,
      samples: 2,
    }
  )
  assert.throws(() => summarizeSamples([]), /samples/)
  assert.deepEqual(evaluateBudgets({ startupMs: 50, rssPeakMiB: 500 }, { startupMs: 100, rssPeakMiB: 400 }), [
    { metric: 'startupMs', value: 50, limit: 100, passed: true },
    { metric: 'rssPeakMiB', value: 500, limit: 400, passed: false },
  ])
  assert.equal(evaluateBudgets({}, { startupMs: 100 })[0].passed, false)
})
