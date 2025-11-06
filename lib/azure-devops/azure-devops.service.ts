import * as azdev from 'azure-devops-node-api'
import { WebApiTeam } from 'azure-devops-node-api/interfaces/CoreInterfaces'
import {
  PullRequestStatus as AzDoPrStatus,
  GitPullRequest,
  IdentityRefWithVote,
  PullRequestAsyncStatus,
} from 'azure-devops-node-api/interfaces/GitInterfaces'
import { Identity } from 'azure-devops-node-api/interfaces/IdentitiesInterfaces'
import { ConnectionData } from 'azure-devops-node-api/interfaces/LocationsInterfaces'
import { IPolicyApi } from 'azure-devops-node-api/PolicyApi'
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { ErrorDetail, ErrorType } from '../models/error-detail'
import { PullRequestData } from '../models/pr-data'
import { PrProfile } from '../models/pr-profile'
import { PrVote } from '../models/pr-vote'
import {
  PullRequest,
  PullRequestMergeStatus,
  PullRequestPolicyConfig,
  PullRequestPolicyEvaluationRecord,
  PullRequestPolicyEvaluationStatus,
  PullRequestPolicyType,
  Reviewer,
} from '../models/pull-request.model'
import { AzDoSettings } from '../models/settings.model'
import { FilterEvaluator } from '../models/ui-filter.model'
import { NotificationService } from '../main/notification.service'
import loader from '../tools/loading.service'
import { throttleAll } from '../tools/promise-throttle'

type PolicyEvaluation = {
  prId: number
  evaluations: PullRequestPolicyEvaluationRecord[]
}

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
  private data: AzureDevOpsData = new AzureDevOpsData()

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

  public async approvePullRequestsForProfile(profile: PrProfile): Promise<void> {
    const prs = FilterEvaluator.evaluate(this.pullRequests.items, profile.filter!)

    if (prs.length === 0) {
      return
    }
    return this.approvePullRequests(prs)
  }

  public async approvePullRequests(prs: PullRequest[]): Promise<void> {
    if (!this.settings || !this.isValidSettings(this.settings) || !this.api) {
      return
    }

    const buildApi = await this.api.getGitApi(this.settings.organizationUrl, [this.api.authHandler])
    const connectionData = await this.api.connect()

    // Filter for PRs where the user is already a reviewer
    if (this.settings.intelligentApproval) {
      const myApproverIds = this.data.teams.map((team) => team.id)
      if (connectionData.authenticatedUser?.id) {
        myApproverIds.push(connectionData.authenticatedUser.id)
      }

      prs = prs.filter((pr) => {
        return (
          pr.reviewers.length == 0 ||
          pr.reviewers.some((reviewer) => {
            return (
              myApproverIds.includes(reviewer.user.id) ||
              reviewer.reviewedBy.some((reviewer) => {
                return myApproverIds.includes(reviewer.user.id)
              })
            )
          })
        )
      })
    }

    log.debug(
      'Approving pull requests: ',
      prs.map((x) => x.id)
    )
    const data = this.pullRequests
    const tasks = prs.map((pr) => {
      return async () => {
        try {
          const reviewer = await buildApi.createPullRequestReviewer(
            {
              vote: 10,
            },
            pr.details.repositoryId,
            pr.id,
            connectionData.authenticatedUser?.id ?? '',
            pr.details.projectId
          )

          // update the related pull request
          AzureDevOpsService.appendReviewer(data, connectionData, pr, reviewer)
        } catch (error) {
          log.error('Failed to approve pull request', error)
        }
      }
    })

    await throttleAll<void>(4, tasks)

    this.pullRequests = data
    BrowserWindow.getAllWindows()[0].webContents.send('pr-data', data)
  }

  private static appendReviewer(
    data: PullRequestData,
    connectionData: ConnectionData,
    pr: PullRequest,
    reviewer: IdentityRefWithVote
  ) {
    const pullRequest = data.items.find((x) => x.id === pr.id)
    if (!pullRequest) {
      return
    }

    const votedForIdentities = reviewer.votedFor?.map((x) => x.id) ?? []
    let votedFor = false
    pullRequest.reviewers.forEach((x) => {
      if (x.user.id === reviewer.id) {
        // Direct vote
        votedFor = true
        x.vote = 10
      } else if (votedForIdentities.includes(x.user.id)) {
        // Indirect vote
        votedFor = true
        x.vote = 10

        const reviewerItem = x.reviewedBy.find((y) => y.user.id === reviewer.id)
        if (!reviewerItem) {
          x.reviewedBy.push({
            user: {
              id: reviewer.id ?? '',
              label: reviewer.displayName ?? '',
              isMySelf: reviewer.id == connectionData.authenticatedUser?.id,
              imageUrl: reviewer.imageUrl,
            },
            vote: 10,
          })
        } else {
          reviewerItem.vote = 10
        }
      }
    })

    if (!votedFor) {
      pullRequest.reviewers.push({
        user: {
          id: reviewer.id ?? '',
          label: reviewer.displayName ?? '',
          isMySelf: reviewer.id == connectionData.authenticatedUser?.id,
          imageUrl: reviewer.imageUrl,
        },
        vote: 10,
      } as Reviewer)
    }
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
        status: AzDoPrStatus.Active,
      })
      data.items = azDoBuilds
        .map((pr) => AzureDevOpsService.mapPullRequests(pr, data))
        .toSorted((a, b) => {
          if (a.creationDate && b.creationDate) {
            return b.creationDate.getTime() - a.creationDate.getTime()
          }
          return 0
        })
      log.debug('Got pull requests from Azure DevOps', data.items.length)

      await AzureDevOpsService.enrichPolicyEvaluations(api, settings, data)
      log.debug('Got policy evaluations from Azure DevOps')

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

  private static mapPullRequests(pr: GitPullRequest, data: AzureDevOpsData): PullRequest {
    return {
      id: pr.pullRequestId,
      author: {
        id: pr.createdBy?.id ?? '',
        label: pr.createdBy?.displayName ?? '',
        isBot: pr.createdBy?.descriptor?.startsWith('svc') ?? false,
        isMySelf: pr.createdBy?.id == data.myself?.id || data.teams.some((team) => team.id === pr.createdBy?.id),
      },
      creationDate: pr.creationDate,
      lastUpdated: {
        label: pr.lastMergeCommit?.comment ?? '',
        timestamp: pr.lastMergeCommit?.push?.date ?? 0,
      },
      isDraft: pr.isDraft,
      details: {
        label: pr.title,
        number: pr.pullRequestId,
        repositoryId: pr.repository?.id ?? '',
        repository: pr.repository?.name ?? '',
        projectId: pr.repository?.project?.id ?? '',
        branch: pr.sourceRefName,
        targetBranch: pr.targetRefName,
        isDraft: pr.isDraft,
        isConflict: pr.mergeStatus === PullRequestAsyncStatus.Conflicts,
      },
      evaluations: [],
      mergeStatus: pr.mergeStatus as unknown as PullRequestMergeStatus,
      mergeFailureMessage: pr.mergeFailureMessage,
      reviewers: this.mapReviewers(pr.reviewers, data.myself, data.teams),
      urls: {
        web: this.createPrWebUri(pr),
      },
    } as PullRequest
  }

  private static async enrichPolicyEvaluations(api: azdev.WebApi, settings: AzDoSettings, data: AzureDevOpsData) {
    const policyApi = await api.getPolicyApi(settings.organizationUrl, [api.authHandler])

    const tasks = data.items.map((pr) => {
      return () => AzureDevOpsService.GetPolicyEvaluations(pr, policyApi, settings)
    })

    const results = await throttleAll<PolicyEvaluation>(4, tasks)

    results.forEach((evaluation) => {
      const pr = data.items.find((pr) => pr.id === evaluation.prId)
      if (pr) {
        pr.evaluations = evaluation.evaluations
      }
    })
  }

  private static async GetPolicyEvaluations(pr: PullRequest, policyApi: IPolicyApi, settings: AzDoSettings) {
    const artifactId = `vstfs:///CodeReview/CodeReviewId/${pr.details.projectId}/${pr.id}`
    const policies = await policyApi.getPolicyEvaluations(settings.project, artifactId, false)
    const evaluations = policies.map((policy) => {
      let displayName = policy.configuration?.type?.displayName ?? ''
      if (policy.configuration?.type?.id === '0609b952-1397-4640-95ec-e00a01b2c241') {
        const buildName = policy.configuration.settings.displayName ?? policy.context?.buildDefinitionName
        if (buildName) {
          displayName = `${displayName} (${buildName})`
        }
      } else if (policy.configuration?.type?.id === 'cbdc66da-9728-4af8-aada-9a5a32e4a226') {
        const statusName = policy.configuration.settings.statusName
        if (statusName) {
          displayName = `${displayName} (${statusName})`
        }
      }

      return {
        id: policy?.evaluationId ?? '',
        displayName: displayName,
        status: policy.status as unknown as PullRequestPolicyEvaluationStatus,
        config: {
          type: {
            id: policy.configuration?.type?.id ?? '',
            displayName: policy.configuration?.type?.displayName ?? '',
            url: policy.configuration?.type?.url ?? '',
          } as PullRequestPolicyType,
        } as PullRequestPolicyConfig,
      } as PullRequestPolicyEvaluationRecord
    })

    return {
      prId: pr.id,
      evaluations: evaluations,
    } as PolicyEvaluation
  }

  private static mapReviewers(
    reviewers: IdentityRefWithVote[] | undefined,
    myself: Identity | undefined,
    teams: WebApiTeam[]
  ): Reviewer[] {
    if (!reviewers) {
      return []
    }

    const mappedReviewers: Reviewer[] = []

    // Group reviewers by their "voted for" status
    reviewers
      .filter((x) => !x.votedFor)
      .forEach((rev) => {
        const mappedRev = {
          user: {
            id: rev.id,
            label: rev.displayName,
            isBot: rev.isAadIdentity,
            isMySelf: rev.id == myself?.id || teams.some((team) => team.id === rev.id),
            imageUrl: rev.imageUrl,
            imageBase64: undefined,
          },
          isRequired: rev.isRequired,
          vote: rev.vote as PrVote,
          reviewedBy: [],
        } as Reviewer

        mappedReviewers.push(mappedRev)
      })

    // Add the "voted for" reviewers
    reviewers
      .filter((x) => x.votedFor)
      .forEach((rev) => {
        const votedForItems = mappedReviewers.filter((x) => rev.votedFor?.some((v) => v.id == x.user.id))

        const mappedRev = {
          user: {
            id: rev.id,
            label: rev.displayName,
            isBot: rev.isAadIdentity,
            isMySelf: rev.id == myself?.id || teams.some((team) => team.id === rev.id),
            imageUrl: rev.imageUrl,
            imageBase64: undefined,
          },
          isRequired: votedForItems.length > 0,
          reviewedBy: votedForItems,
          vote: rev.vote as PrVote,
        } as Reviewer

        votedForItems.forEach((item) => {
          item.reviewedBy = item.reviewedBy || []
          item.reviewedBy.push(mappedRev)
        })
      })

    return mappedReviewers
  }

  private async updateData(): Promise<void> {
    const data: PullRequestData = {
      items: [],
      error: null,
    }

    if (this.settings && this.api && this.isValidSettings(this.settings)) {
      loader.start()

      const oldPRIds = new Set(this.pullRequests.items.map((pr) => pr.id))
      const newData = await AzureDevOpsService.loadPullRequestData(this.api, this.settings)
      this.data = newData
      data.items = newData.items
      data.error = newData.error

      // Detect new PRs and send notifications
      const newPRs = data.items.filter((pr) => !oldPRIds.has(pr.id))
      if (newPRs.length > 0) {
        NotificationService.getInstance().notifyNewPullRequests(newPRs)
      }
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
