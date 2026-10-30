import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { NotificationService } from '../lib/main/notification.service'
import type { PullRequest } from '../lib/models/pull-request.model'

test('independent refreshes notify each new PR once even when integration ownership changes', () => {
  const bodies: string[] = []
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
      if (name === '../main/tray') return { getTrayManager: () => undefined }
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
})
