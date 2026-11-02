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
  service.setSettings(
    { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
    [
      {
        id: 'all',
        label: 'All',
        visible: true,
        enableAcceptAll: false,
        notifyOnNewPrs: true,
        filter: { op: 'AND', filters: [] },
      },
    ]
  )
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
  service.initialize([pr('baseline', now - 10000)])
  const first = pr('first', now - 1000)
  const second = pr('second', now - 1000)
  service.notifyNewPullRequests([first])
  service.notifyNewPullRequests([first, second])
  service.notifyNewPullRequests([first, { ...second, integrationId: 'replacement' }])
  assert.deepEqual(bodies, ['Author: first', 'Author: second'])

  service.setSettings(
    { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
    [{ id: 'all', label: 'All', visible: true, enableAcceptAll: false, notifyOnNewPrs: true }]
  )
  service.initialize([pr('baseline', now - 10000)])
  service.notifyNewPullRequests([pr('blank-filter', now - 1000)])
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), true)

  service.setSettings(
    { openAtLogin: false, enableNotifications: false, notificationSound: false, repositoriesRootDirectory: '' },
    [{ id: 'all', label: 'All', visible: true, enableAcceptAll: false, notifyOnNewPrs: true }]
  )
  service.initialize([pr('baseline', now - 10000)])
  service.notifyNewPullRequests([pr('global-disabled', now - 1000)])
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])

  service.setSettings(
    { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
    [{ id: 'off', label: 'Off', visible: true, enableAcceptAll: false, notifyOnNewPrs: false }]
  )
  service.initialize([pr('baseline', now - 10000)])
  service.notifyNewPullRequests([pr('opted-out', now - 1000)])
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), false)

  service.setSettings(
    { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
    [
      {
        id: 'invalid',
        label: 'Invalid',
        visible: true,
        enableAcceptAll: false,
        notifyOnNewPrs: true,
        filter: { op: 'XOR', filters: [] } as unknown as PullRequestFilter,
      } as PrProfile,
    ]
  )
  service.initialize([pr('baseline', now - 10000)])
  service.notifyNewPullRequests([pr('invalid-filter', now - 1000)])
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), false)

  service.setSettings(
    { openAtLogin: false, enableNotifications: true, notificationSound: false, repositoriesRootDirectory: '' },
    [
      {
        id: 'null-filter',
        label: 'Null filter',
        visible: true,
        enableAcceptAll: false,
        notifyOnNewPrs: true,
        filter: null as unknown as PullRequestFilter,
      } as PrProfile,
    ]
  )
  service.initialize([pr('baseline', now - 10000)])
  service.notifyNewPullRequests([pr('null-filter', now - 1000)])
  assert.deepEqual(bodies, ['Author: first', 'Author: second', 'Author: blank-filter'])
  assert.equal(trayStates.at(-1), false)
})
