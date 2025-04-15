import * as azdev from 'azure-devops-node-api'
import { WebApiTeam } from 'azure-devops-node-api/interfaces/CoreInterfaces'
import {
  CommentThreadStatus,
  CommentType,
  GitPullRequest,
  PullRequestAsyncStatus,
  PullRequestStatus,
} from 'azure-devops-node-api/interfaces/GitInterfaces'
import { Identity } from 'azure-devops-node-api/interfaces/IdentitiesInterfaces'
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { ErrorDetail, ErrorType } from '../models/error-detail'
import { PullRequestData } from '../models/pr-data'
import { PrVote } from '../models/pr-vote'
import { PullRequest, PullRequestThreadState } from '../models/pull-request.model'
import { AzDoSettings } from '../models/settings.model'
import loader from '../tools/loading.service'

export class AzureDevOpsService {
  private static instance: AzureDevOpsService
  public static getInstance(): AzureDevOpsService {
    if (!this.instance) {
      this.instance = new AzureDevOpsService()
    }
    return this.instance
  }

  private settings?: AzDoSettings
  private api?: azdev.WebApi
  private active: boolean
  private pullRequests: PullRequestData

  constructor() {
    this.active = false
    this.pullRequests = { items: [], error: null }
  }

  public stop(): void {
    if (!this.active) {
      return
    }
    this.active = false
  }

  public getPullRequests(): PullRequestData {
    return this.pullRequests
  }

  public async approvePullRequests(prs: PullRequest[]): Promise<void> {
    if (!this.settings || !this.isValidSettings(this.settings) || !this.api) {
      return
    }

    const buildApi = await this.api.getGitApi(this.settings.organizationUrl, [this.api.authHandler])
    const connectionData = await this.api.connect()

    prs.forEach(async (pr) => {
      await buildApi.createPullRequestReviewer(
        {
          vote: 10,
        },
        pr.details.repositoryId,
        pr.id,
        connectionData.authenticatedUser?.id ?? '',
        pr.details.projectId
      )
    })
  }

  public async updateDataImmediately(): Promise<void> {
    return this.updateData()
  }

  public start(): void {
    if (!this.active) {
      this.startCore()
    }
  }

  public setConfiguration(input: AzDoSettings): void {
    const hasChanged = JSON.stringify(this.settings) !== JSON.stringify(input)
    this.settings = input

    if (hasChanged) {
      this.reInitializeApi()
    }
  }

  private static convertThreadStatus(rowState: CommentThreadStatus | undefined): PullRequestThreadState {
    if (!rowState) {
      return PullRequestThreadState.Unknown
    }
    return PullRequestThreadState[CommentThreadStatus[rowState] as keyof typeof PullRequestThreadState]
  }

  private static createPrWebUri(pr: GitPullRequest): string {
    const template = pr._links.self.href

    return template.replace('_apis/git/repositories', '_git').replace('pullRequests', 'pullRequest')
  }

  private static async loadMyTeams(api: azdev.WebApi, settings: AzDoSettings): Promise<WebApiTeam[]> {
    const buildApi = await api.getCoreApi(settings.organizationUrl, [api.authHandler])
    const teams = await buildApi.getTeams(settings.project, true)

    return teams
  }

  private static async loadPullRequestData(api: azdev.WebApi, settings: AzDoSettings): Promise<AzureDevOpsData> {
    const data: AzureDevOpsData = new AzureDevOpsData()

    try {
      const connectionData = await api.connect()
      data.myself = connectionData.authenticatedUser
      data.teams = await AzureDevOpsService.loadMyTeams(api, settings)
      log.debug('Fetching data from Azure DevOps')
      const buildApi = await api.getGitApi(settings.organizationUrl, [api.authHandler])
      const azDoBuilds = await buildApi.getPullRequestsByProject(settings.project, {
        includeLinks: true,
        status: PullRequestStatus.Active,
      })
      data.items = azDoBuilds.map((pr) => {
        return {
          id: pr.pullRequestId,
          author: {
            id: pr.createdBy?.id ?? '',
            label: pr.createdBy?.displayName ?? '',
            isBot: pr.createdBy?.descriptor?.startsWith('svc') ?? false,
            isMySelf: pr.createdBy?.id == data.myself?.id || data.teams.some((team) => team.id === pr.createdBy?.id),
          },
          lastUpdated: {
            label: pr.lastMergeCommit?.comment ?? '',
            timestamp: pr.lastMergeCommit?.push?.date ?? 0,
          },
          interactions: {
            threads: [],
            activeThreads: 0,
            activeFromBots: 0,
          },
          isDraft: pr.isDraft,
          details: {
            label: pr.title,
            number: pr.pullRequestId,
            repositoryId: pr.repository?.id ?? '',
            repository: pr.repository?.name ?? '',
            projectId: pr.repository?.project?.id ?? '',
            branch: pr.sourceRefName,
            isDraft: pr.isDraft,
            isConflict: pr.mergeStatus === PullRequestAsyncStatus.Conflicts,
          },
          mergeStatus: pr.mergeStatus as any,
          mergeFailureMessage: pr.mergeFailureMessage,
          reviewers: pr.reviewers?.map((reviewer) => {
            return {
              user: {
                id: reviewer.id,
                label: reviewer.displayName,
                isBot: reviewer.isAadIdentity,
                isMySelf: reviewer.id == data.myself?.id || data.teams.some((team) => team.id === reviewer.id),
                imageUrl: reviewer.imageUrl,
                imageBase64: undefined,
              },
              isRequired: reviewer.isRequired,
              vote: reviewer.vote as PrVote,
            }
          }),
          urls: {
            web: this.createPrWebUri(pr),
          },
        } as PullRequest
      })

      const threads = await Promise.all(
        data.items.map(async (pr) => {
          return {
            pr: pr.id,
            threads: await buildApi.getThreads(pr.details.repositoryId, pr.id, pr.details.projectId),
          }
        })
      )

      for (const pr of data.items) {
        const thread = threads.find((thread) => thread.pr === pr.id)
        if (thread) {
          pr.interactions.threads = thread.threads
            .filter((x) => !x.properties?.CodeReviewThreadType)
            .filter((x) => x.status === CommentThreadStatus.Active || x.status === CommentThreadStatus.Pending)
            .filter((x) => x.comments && x.comments.length > 0)
            .filter((x) => x.comments?.every((c) => c.commentType !== CommentType.System && c.isDeleted !== true))
            .map((thread) => {
              return {
                id: thread.id ?? 0,
                state: this.convertThreadStatus(thread.status),
                comments:
                  thread.comments?.map((comment) => {
                    return {
                      id: comment.id ?? 0,
                      content: comment.content ?? '',
                      author: {
                        id: comment.author?.id ?? '',
                        label: comment.author?.displayName ?? '',
                        isBot:
                          (comment.author?.descriptor?.startsWith('svc') ||
                            comment.author?.descriptor?.startsWith('s2s')) ??
                          false,
                        imageUrl: comment.author?.imageUrl,
                      },
                    }
                  }) ?? [],
              }
            })
          pr.interactions.activeThreads = pr.interactions.threads.length
          pr.interactions.activeFromBots = pr.interactions.threads.filter((x) =>
            x.comments.some((c) => c.author.isBot)
          ).length
        }
      }

      log.debug('Completed to fetch data')
    } catch (error) {
      log.error('Failed to fetch data', error)
      if (error instanceof Error) {
        const statusCode = (error as AzError).statusCode ?? 0
        const errorType = statusCode === 401 ? ErrorType.Authentication : ErrorType.Unknown
        data.error = {
          message: error.message,
          details: 'Please check your authentication settings.',
          type: errorType,
          actionText: errorType === ErrorType.Authentication ? 'DevOps Settings' : undefined,
          actionHref: errorType === ErrorType.Authentication ? '/settings/azure-devops' : undefined,
        }
      }
    }
    return data
  }

  private async updateData(): Promise<void> {
    const data: PullRequestData = {
      items: [],
      error: null,
    }

    if (this.settings && this.api && this.isValidSettings(this.settings)) {
      loader.start()

      const newData = await AzureDevOpsService.loadPullRequestData(this.api, this.settings)
      data.items = newData.items
      data.error = newData.error
    } else {
      data.error = {
        message: 'Configuration required',
        details: 'Please set-up an integration first to get started.',
        type: ErrorType.ConfigurationRequired,
        actionText: 'Azure DevOps Settings',
        actionHref: '/settings/azure-devops',
      }
    }
    this.pullRequests = data
    BrowserWindow.getAllWindows()[0].webContents.send('pr-data', data)
    loader.stop()
  }

  private initializeApi(): azdev.WebApi {
    if (!this.settings) {
      throw new Error('Settings not set')
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(this.settings.pat)
    const options = {
      allowRetries: true,
      maxRetries: 20,
      socketTimeout: 30000,
    }
    return new azdev.WebApi(this.settings.organizationUrl, authHandler, options)
  }

  private reInitializeApi(): void {
    this.api = this.initializeApi()
  }

  private async onTick(): Promise<void> {
    if (!this.active) {
      return
    }

    await this.updateData()
    const interval = this.settings?.updateInterval ?? 180
    setTimeout(() => this.onTick(), interval * 1000)
  }

  private startCore(): void {
    this.reInitializeApi()
    this.active = true

    this.onTick()
  }

  private isValidSettings(input?: AzDoSettings): boolean {
    if (!input) {
      return false
    }

    return !!input.organizationUrl && !!input.project && !!input.pat
  }
}

class AzureDevOpsData implements PullRequestData {
  items: PullRequest[] = []
  error: ErrorDetail | null = null
  teams: WebApiTeam[] = []
  myself: Identity | undefined = undefined
}

interface AzError extends Error {
  statusCode: number
}
