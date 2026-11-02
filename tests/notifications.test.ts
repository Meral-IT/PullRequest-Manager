import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { NotificationService } from '../lib/main/notification.service'
import type { PrProfile } from '../lib/models/pr-profile'
import type { PullRequest } from '../lib/models/pull-request.model'
import type { PullRequestFilter } from '../lib/models/ui-filter.model'

test('blank notification filters match all while preserving de-duplication and opt-outs', () => {
  const bodies: string[] = []
  const trayStates: boolean[] = []
  const localRequire = createRequire(path.join(__dirname, '../lib/main/notification.service.js'))
  const result = { exports: {} as { NotificationService: typeof NotificationService } }
  const source = ts.transpileModule(readFileSync('lib/main/notification.service.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(source, {
    module: result,
    exports: result.exports,
    require: (name: string) => {
      if (name === 'electron')
        return {
          Notification: class {
            constructor(private options: { body: string }) {}
            on() {
              return this
            }
            show() {
              bodies.push(this.options.body)
            }
          },
        }
      if (name === 'electron-log/main') return { debug: () => {} }
      if (name === '../main/tray')
        return { getTrayManager: () => ({ setActiveState: (active: boolean) => trayStates.push(active) }) }
      return localRequire(name)
    },
  })
  const service = new result.exports.NotificationService()
  const settings = { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' }
  const enabledProfile: PrProfile = {
    id: 'all',
    label: 'All',
    visible: true,
    enableAcceptAll: false,
    notifyOnNewPrs: true,
  }
  const pr = (organizationId: string, time: number) =>
    ({
      id: 1,
      integrationId: organizationId,
      author: { label: 'Author' },
      creationDate: new Date(time),
      details: { organizationId, repositoryId: 'repo', label: organizationId },
      urls: { web: '' },
    }) as PullRequest
  const now = Date.now()
  const notifyProfile = (profile: PrProfile, organizationId: string, enableNotifications = true) => {
    service.setSettings({ ...settings, enableNotifications }, [profile])
    service.initialize([pr('baseline', now - 10000)])
    service.notifyNewPullRequests([pr(organizationId, now - 1000)])
  }

  service.setSettings(settings, [{ ...enabledProfile, filter: { op: 'AND', filters: [] } }])
  service.initialize([pr('baseline', now - 10000)])
  const first = pr('first', now - 1000)
  const second = pr('second', now - 1000)
  service.notifyNewPullRequests([first])
  service.notifyNewPullRequests([first, second])
  service.notifyNewPullRequests([first, { ...second, integrationId: 'replacement' }])
  assert.deepEqual(bodies, ['Author: first', 'Author: second'])

  notifyProfile(enabledProfile, 'blank-filter')
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), true)

  notifyProfile(enabledProfile, 'global-disabled', false)
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])

  notifyProfile({ ...enabledProfile, id: 'off', notifyOnNewPrs: false }, 'opted-out')
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), false)

  notifyProfile(
    { ...enabledProfile, id: 'invalid', filter: { op: 'XOR', filters: [] } as unknown as PullRequestFilter },
    'invalid-filter'
  )
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), false)

  notifyProfile(
    { ...enabledProfile, id: 'null-filter', filter: null as unknown as PullRequestFilter },
    'null-filter'
  )
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), false)
})
