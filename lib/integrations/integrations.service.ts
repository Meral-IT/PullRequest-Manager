import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { randomUUID } from 'node:crypto'
import { NotificationService } from '../main/notification.service'
import { AzureDevOpsConnection } from '../models/azure-devops-access'
import { ErrorType } from '../models/error-detail'
import { PullRequestData } from '../models/pr-data'
import { PrProfile } from '../models/pr-profile'
import { PullRequest, pullRequestKey } from '../models/pull-request.model'
import { Integration, GitHubIntegration, sameIntegrationConnection } from '../models/settings.model'
import { FilterEvaluator } from '../models/ui-filter.model'
import { AzureDevOpsService } from '../azure-devops/azure-devops.service'
import { GitHubService } from '../github/github.service'

export class IntegrationsService {
  private static instance: IntegrationsService
  public static getInstance(): IntegrationsService {
    this.instance ??= new IntegrationsService()
    return this.instance
  }

  private readonly services = new Map<
    string,
    { settings: Integration; revision: string; service: AzureDevOpsService | GitHubService }
  >()
  private active = false
  private configuring = false

  public setConfiguration(integrations: Integration[]): void {
    this.configuring = true
    try {
      for (const [id, entry] of this.services) {
        if (!integrations.some((integration) => integration.id === id && integration.type === entry.settings.type)) {
          entry.service.stop()
          this.services.delete(id)
        }
      }
      for (const settings of integrations) {
        let entry = this.services.get(settings.id)
        if (!entry) {
          entry = {
            settings,
            revision: randomUUID(),
            service:
              settings.type === 'github'
                ? new GitHubService(() => this.publishData())
                : new AzureDevOpsService(() => this.publishData()),
          }
          this.services.set(settings.id, entry)
        }
        if (!sameIntegrationConnection(entry.settings, settings)) entry.revision = randomUUID()
        entry.settings = { ...settings }
        if (settings.type === 'github' && entry.service instanceof GitHubService)
          entry.service.setConfiguration(settings)
        if (settings.type === 'azure-devops' && entry.service instanceof AzureDevOpsService)
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
    for (const [id, { service, settings, revision }] of this.services) {
      const data = service.getPullRequests()
      integrations.push(
        service instanceof GitHubService
          ? { id, name: settings.name, type: 'github', access: service.getPullRequests().access, error: data.error }
          : {
              id,
              name: settings.name,
              type: 'azure-devops',
              access: service.getPullRequests().access,
              error: data.error,
            }
      )
      for (const pr of data.items) {
        const key = pullRequestKey(pr)
        if (!items.has(key)) items.set(key, { ...pr, integrationId: id, integrationRevision: revision })
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
            actionText: 'Integration settings',
            actionHref: '/settings/integrations/new',
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
    const existing = this.services.get(integrationId)?.service
    const service = existing instanceof AzureDevOpsService ? existing : new AzureDevOpsService(() => {})
    return service.validateConnection(connection)
  }

  public validateGitHubConnection(connection: GitHubIntegration) {
    const existing = this.services.get(connection.id)?.service
    const service = existing instanceof GitHubService ? existing : new GitHubService(() => {})
    return service.validateConnection(connection)
  }

  public canAcknowledgeAccess(fingerprint: string, revision: number, integrationId: string): boolean {
    const service = this.services.get(integrationId)?.service
    return service instanceof AzureDevOpsService && service.canAcknowledgeAccess(fingerprint, revision)
  }

  public acknowledgeAccess(integrationId: string): void {
    const service = this.services.get(integrationId)?.service
    if (service instanceof AzureDevOpsService) service.acknowledgeAccess()
  }

  public approvePullRequestsForProfile(profile: PrProfile): Promise<void> {
    return this.approvePullRequests(
      FilterEvaluator.evaluate(this.getPullRequests().items, profile.filter ?? { op: 'AND', filters: [] })
    )
  }

  public async approvePullRequests(prs: PullRequest[]): Promise<void> {
    const current = new Map(this.getPullRequests().items.map((pr) => [pullRequestKey(pr), pr]))
    const selected: PullRequest[] = []
    const failures: string[] = []
    for (const [key, pr] of new Map(prs.map((pr) => [pullRequestKey(pr), pr]))) {
      const row = current.get(key)
      if (
        !row ||
        pr.integrationId !== row.integrationId ||
        !pr.integrationRevision ||
        pr.integrationRevision !== row.integrationRevision
      ) {
        failures.push(`#${pr.id}: Connection changed. Refresh before changing reviews.`)
      } else selected.push({ ...row, headCommitId: pr.headCommitId })
    }
    const results = await Promise.allSettled(
      [...this.services].map(([id, { service }]) => {
        const items = selected.filter((pr) => pr.integrationId === id)
        return items.length ? service.approvePullRequests(items) : Promise.resolve()
      })
    )
    for (const result of results)
      if (result.status === 'rejected')
        failures.push(result.reason instanceof Error ? result.reason.message : 'Review action failed.')
    if (failures.length) throw new Error(failures.join('\n'))
  }

  public async resetPullRequestFeedback(pr: PullRequest): Promise<void> {
    const current = this.getPullRequests().items.find((item) => pullRequestKey(item) === pullRequestKey(pr))
    if (
      !current ||
      current.integrationId !== pr.integrationId ||
      !pr.integrationRevision ||
      current.integrationRevision !== pr.integrationRevision
    )
      throw new Error('Connection changed. Refresh before changing reviews.')
    await this.services.get(current.integrationId!)?.service.resetPullRequestFeedback(current)
  }
}
