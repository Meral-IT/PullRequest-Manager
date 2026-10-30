import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { NotificationService } from '../main/notification.service'
import { AzureDevOpsConnection } from '../models/azure-devops-access'
import { ErrorType } from '../models/error-detail'
import { PullRequestData } from '../models/pr-data'
import { PrProfile } from '../models/pr-profile'
import { PullRequest, pullRequestKey } from '../models/pull-request.model'
import { AzDoIntegration } from '../models/settings.model'
import { FilterEvaluator } from '../models/ui-filter.model'
import { AzureDevOpsService } from './azure-devops.service'

export class AzureDevOpsIntegrationsService {
  private static instance: AzureDevOpsIntegrationsService
  public static getInstance(): AzureDevOpsIntegrationsService {
    return (this.instance ??= new AzureDevOpsIntegrationsService())
  }

  private services = new Map<string, { settings: AzDoIntegration; service: AzureDevOpsService }>()
  private active = false
  private configuring = false

  public setConfiguration(integrations: AzDoIntegration[]): void {
    this.configuring = true
    try {
      for (const [id, entry] of this.services) {
        if (!integrations.some((integration) => integration.id === id)) {
          entry.service.stop()
          this.services.delete(id)
        }
      }
      for (const settings of integrations) {
        let entry = this.services.get(settings.id)
        if (!entry) {
          entry = { settings, service: new AzureDevOpsService(() => this.publishData()) }
          this.services.set(settings.id, entry)
        }
        entry.settings = { ...settings }
        entry.service.setConfiguration(settings)
      }
    } finally {
      this.configuring = false
    }
    this.publishData()
    if (this.active) this.start()
  }

  public start(): void {
    this.active = true
    for (const { service } of this.services.values()) service.start()
  }

  public stop(): void {
    this.active = false
    for (const { service } of this.services.values()) service.stop()
  }

  public getPullRequests(): PullRequestData {
    const items = new Map<string, PullRequest>()
    const integrations: NonNullable<PullRequestData['integrations']> = []
    for (const [id, { service, settings }] of this.services) {
      const data = service.getPullRequests()
      integrations.push({ id, name: settings.name, access: data.access, error: data.error })
      for (const pr of data.items) {
        const key = pullRequestKey(pr)
        if (!items.has(key)) items.set(key, { ...pr, integrationId: id })
      }
    }
    return {
      items: [...items.values()].toSorted(
        (a, b) => (b.creationDate?.getTime() ?? 0) - (a.creationDate?.getTime() ?? 0)
      ),
      integrations,
      error: this.services.size
        ? null
        : {
            message: 'Configuration required',
            details: 'Please set-up an integration first to get started.',
            type: ErrorType.ConfigurationRequired,
            actionText: 'Azure DevOps Settings',
            actionHref: '/settings/azure-devops',
          },
    }
  }

  private publishData(): void {
    if (this.configuring) return
    const data = this.getPullRequests()
    try {
      NotificationService.getInstance().notifyNewPullRequests(data.items)
    } catch (error) {
      log.error('Failed to send notification', error)
    }
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('pr-data', data)
  }

  public async updateDataImmediately(): Promise<void> {
    await Promise.all([...this.services.values()].map(({ service }) => service.updateDataImmediately()))
  }

  public validateConnection(connection: AzureDevOpsConnection, integrationId: string) {
    const service = this.services.get(integrationId)?.service ?? new AzureDevOpsService(() => {})
    return service.validateConnection(connection)
  }

  public canAcknowledgeAccess(fingerprint: string, revision: number, integrationId: string): boolean {
    return this.services.get(integrationId)?.service.canAcknowledgeAccess(fingerprint, revision) ?? false
  }

  public acknowledgeAccess(integrationId: string): void {
    this.services.get(integrationId)?.service.acknowledgeAccess()
  }

  public approvePullRequestsForProfile(profile: PrProfile): Promise<void> {
    return this.approvePullRequests(
      FilterEvaluator.evaluate(this.getPullRequests().items, profile.filter ?? { op: 'AND', filters: [] })
    )
  }

  public async approvePullRequests(prs: PullRequest[]): Promise<void> {
    const selected = new Set(prs.map(pullRequestKey))
    const current = this.getPullRequests().items.filter((pr) => selected.has(pullRequestKey(pr)))
    await Promise.all(
      [...this.services].map(([id, { service }]) => {
        const items = current.filter((pr) => pr.integrationId === id)
        return items.length ? service.approvePullRequests(items) : Promise.resolve()
      })
    )
  }

  public async resetPullRequestFeedback(pr: PullRequest): Promise<void> {
    const current = this.getPullRequests().items.find((item) => pullRequestKey(item) === pullRequestKey(pr))
    if (current?.integrationId)
      await this.services.get(current.integrationId)?.service.resetPullRequestFeedback(current)
  }
}
