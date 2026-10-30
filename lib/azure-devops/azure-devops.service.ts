import * as azdev from 'azure-devops-node-api'
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
import { NotificationService } from '../main/notification.service'
import { ErrorDetail, ErrorType } from '../models/error-detail'
import {
  AzureDevOpsAccess,
  AzureDevOpsAccessResult,
  AzureDevOpsConnection,
  AzureDevOpsFeature,
  AzureDevOpsValidationResult,
  createAzureDevOpsAccess,
  getAzureDevOpsAccessFailure,
  sameAzureDevOpsConnection,
  azureDevOpsRequirements,
} from '../models/azure-devops-access'
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
  private active: boolean = false
  private pullRequests: PullRequestData = { items: [], error: null }
  private data: AzureDevOpsData = new AzureDevOpsData()
  private connectionRevision = 0

  private static async checkAccess<T>(
    access: AzureDevOpsAccess,
    feature: AzureDevOpsFeature,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      const result = await operation()
      access.features[feature] = { status: 'verified', message: 'Access verified for the current connection.' }
      return result
    } catch (error) {
      this.recordAccessFailure(access, feature, error)
      throw error
    }
  }

  private static recordAccessFailure(access: AzureDevOpsAccess, feature: AzureDevOpsFeature, error: unknown): void {
    const failure = getAzureDevOpsAccessFailure(error)
    if (access.features[feature].status !== 'denied' || failure.status === 'denied') access.features[feature] = failure
  }

  private static async connect(api: azdev.WebApi): Promise<ConnectionData> {
    const connection = await api.connect()
    if (
      !connection.authenticatedUser?.id ||
      connection.authenticatedUser.id === '00000000-0000-0000-0000-000000000000'
    ) {
      throw Object.assign(new Error('Authentication failed'), { statusCode: 401 })
    }
    return connection
  }

  public static async validateAccess(
    api: azdev.WebApi,
    settings: AzureDevOpsConnection
  ): Promise<AzureDevOpsValidationResult> {
    const access = createAzureDevOpsAccess()
    let connection: ConnectionData
    try {
      connection = await this.connect(api)
    } catch (error) {
      const failure = getAzureDevOpsAccessFailure(error)
      access.features = { code: failure, identity: failure, vote: failure }
      return { userDisplayName: null, error: failure.message, access }
    }
    let policyChecked = false
    await Promise.allSettled([
      this.checkAccess(access, 'code', async () => {
        const git = await api.getGitApi(settings.organizationUrl, [api.authHandler])
        const [pr] = await git.getPullRequestsByProject(
          settings.project,
          { status: AzDoPrStatus.Active },
          undefined,
          undefined,
          1
        )
        if (pr) {
          const policies = await api.getPolicyApi(settings.organizationUrl, [api.authHandler])
          await policies.getPolicyEvaluations(
            settings.project,
            `vstfs:///CodeReview/CodeReviewId/${pr.repository?.project?.id}/${pr.pullRequestId}`,
            false
          )
          policyChecked = true
        }
      }),
      this.checkAccess(access, 'identity', () => this.loadMyTeams(api, settings, connection.authenticatedUser)),
    ])
    if (access.features.code.status === 'verified' && !policyChecked)
      access.features.code = {
        status: 'unverified',
        message: 'PR read access verified. Policy access is not verified until a PR is available.',
      }
    return {
      userDisplayName: connection.authenticatedUser?.providerDisplayName ?? 'Azure DevOps user',
      error: null,
      access,
    }
  }

  public async validateConnection(settings: AzureDevOpsConnection): Promise<AzureDevOpsValidationResult> {
    let validUrl = false
    try {
      validUrl = ['https:', 'http:'].includes(new URL(settings.organizationUrl).protocol)
    } catch {
      /* Invalid input is reported below. */
    }
    if (!validUrl || !settings.project || !settings.pat) {
      const access = createAzureDevOpsAccess()
      const failure = getAzureDevOpsAccessFailure({ statusCode: 400 })
      access.features = { code: failure, identity: failure, vote: failure }
      return { userDisplayName: null, error: 'Enter an organization URL, project, and PAT before validating.', access }
    }
    const revision = this.connectionRevision
    const matches = this.settings && sameAzureDevOpsConnection(settings, this.settings)
    const api = new azdev.WebApi(settings.organizationUrl, azdev.getPersonalAccessTokenHandler(settings.pat), {
      socketTimeout: 30000,
    })
    const result = await AzureDevOpsService.validateAccess(api, settings)
    if (matches && revision === this.connectionRevision) {
      result.access.connectionRevision = revision
      result.access.acknowledged = this.pullRequests.access?.acknowledged ?? false
      for (const { id } of azureDevOpsRequirements) {
        const previous = this.pullRequests.access?.features[id]
        if (previous?.status === 'denied' && result.access.features[id].status === 'unverified')
          result.access.features[id] = previous
      }
      if (!result.error && this.pullRequests.access)
        result.access.features.vote = this.pullRequests.access.features.vote
      this.pullRequests = { ...this.pullRequests, access: result.access }
      this.publishData()
    }
    return result
  }

  public canAcknowledgeAccess(fingerprint: string, revision: number): boolean {
    return (
      !!this.pullRequests.access &&
      this.pullRequests.access.requirementsFingerprint === fingerprint &&
      this.connectionRevision === revision
    )
  }

  public acknowledgeAccess(): void {
    if (this.pullRequests.access) this.pullRequests.access.acknowledged = true
    this.publishData()
  }

  private publishData(): void {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('pr-data', this.pullRequests)
  }

  private publishVoteAccess(result: AzureDevOpsAccessResult, revision: number): void {
    if (revision !== this.connectionRevision) return
    const access = this.pullRequests.access ?? createAzureDevOpsAccess(undefined, revision)
    if (result.status === 'unverified' && access.features.vote.status === 'denied') result = access.features.vote
    this.pullRequests = { ...this.pullRequests, access: { ...access, features: { ...access.features, vote: result } } }
    this.publishData()
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

    const revision = this.connectionRevision
    const settings = this.settings
    const api = this.api
    const access = structuredClone(this.pullRequests.access ?? createAzureDevOpsAccess(undefined, revision))
    let buildApi: Awaited<ReturnType<azdev.WebApi['getGitApi']>>
    let connectionData: ConnectionData
    try {
      connectionData = await AzureDevOpsService.connect(api)
      buildApi = await api.getGitApi(settings.organizationUrl, [api.authHandler])
    } catch (error) {
      this.publishVoteAccess(getAzureDevOpsAccessFailure(error), revision)
      return
    }
    if (revision !== this.connectionRevision) return

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
    const failures: AzureDevOpsAccessResult[] = []
    const tasks = prs.map((pr) => {
      return async () => {
        if (revision !== this.connectionRevision) return
        try {
          const reviewer = await AzureDevOpsService.checkAccess(access, 'vote', () =>
            buildApi.createPullRequestReviewer(
              {
                vote: 10,
              },
              pr.details.repositoryId,
              pr.id,
              connectionData.authenticatedUser?.id ?? '',
              pr.details.projectId
            )
          )

          // update the related pull request
          if (revision === this.connectionRevision)
            AzureDevOpsService.appendReviewer(this.pullRequests, connectionData, pr, reviewer)
        } catch (error) {
          failures.push(getAzureDevOpsAccessFailure(error))
          log.error('Failed to approve pull request', getAzureDevOpsAccessFailure(error).message)
        }
      }
    })

    await throttleAll<void>(4, tasks)
    if (failures.length) access.features.vote = failures.find((failure) => failure.status === 'denied') ?? failures[0]

    this.publishVoteAccess(access.features.vote, revision)
  }

  public async resetPullRequestFeedback(pr: PullRequest): Promise<void> {
    if (!this.settings || !this.isValidSettings(this.settings) || !this.api) {
      return
    }

    const revision = this.connectionRevision
    const settings = this.settings
    const api = this.api
    const access = structuredClone(this.pullRequests.access ?? createAzureDevOpsAccess(undefined, revision))
    try {
      const connectionData = await AzureDevOpsService.connect(api)
      const buildApi = await api.getGitApi(settings.organizationUrl, [api.authHandler])
      if (revision !== this.connectionRevision) return
      const reviewer = await AzureDevOpsService.checkAccess(access, 'vote', () =>
        buildApi.createPullRequestReviewer(
          {
            vote: PrVote.NoVote,
          },
          pr.details.repositoryId,
          pr.id,
          connectionData.authenticatedUser?.id ?? '',
          pr.details.projectId
        )
      )

      if (revision === this.connectionRevision)
        AzureDevOpsService.appendReviewer(this.pullRequests, connectionData, pr, reviewer)
    } catch (error) {
      access.features.vote = getAzureDevOpsAccessFailure(error)
      log.error('Failed to reset pull request feedback', access.features.vote.message)
    }
    this.publishVoteAccess(access.features.vote, revision)
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
    const vote = (reviewer.vote as PrVote | undefined) ?? PrVote.NoVote
    let votedFor = false

    for (const x of pullRequest.reviewers) {
      if (x.user.id === reviewer.id) {
        // Direct vote
        votedFor = true
        x.vote = vote
      } else if (votedForIdentities.includes(x.user.id)) {
        // Indirect vote
        votedFor = true
        x.vote = vote

        const reviewerItem = x.reviewedBy.find((y) => y.user.id === reviewer.id)
        if (reviewerItem) {
          reviewerItem.vote = vote
        } else {
          x.reviewedBy.push({
            user: {
              id: reviewer.id ?? '',
              label: reviewer.displayName ?? '',
              isMySelf: reviewer.id == connectionData.authenticatedUser?.id,
              imageUrl: reviewer.imageUrl,
            },
            vote: vote,
          })
        }
      }
    }

    if (!votedFor) {
      pullRequest.reviewers.push({
        user: {
          id: reviewer.id ?? '',
          label: reviewer.displayName ?? '',
          isMySelf: reviewer.id == connectionData.authenticatedUser?.id,
          imageUrl: reviewer.imageUrl,
        },
        vote: vote,
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
    const connectionChanged = !this.settings || !sameAzureDevOpsConnection(this.settings, input)
    const acknowledgement = this.settings && connectionChanged ? undefined : input.acknowledgedScopeRequirements
    this.settings = { ...input }

    if (connectionChanged) {
      this.connectionRevision++
      this.pullRequests = {
        items: [],
        error: null,
        access: this.isValidSettings(input)
          ? createAzureDevOpsAccess(acknowledgement, this.connectionRevision)
          : undefined,
      }
      this.data = new AzureDevOpsData()
      this.publishData()
    } else if (this.pullRequests.access) {
      this.pullRequests.access.acknowledged = createAzureDevOpsAccess(input.acknowledgedScopeRequirements).acknowledged
    }

    if (hasChanged) {
      this.reInitializeApi()
    }
  }

  private static createPrWebUri(pr: GitPullRequest): string {
    const template = pr._links.self.href

    return template.replace('_apis/git/repositories', '_git').replace('pullRequests', 'pullRequest')
  }

  private static async loadMyTeams(
    api: azdev.WebApi,
    settings: AzureDevOpsConnection,
    myself: Identity | undefined
  ): Promise<Identity[]> {
    if (!myself?.id) {
      return []
    }

    // The SDK has no identity client; resolve its service URL rather than assuming a cloud hostname.
    const locationsApi = await api.getLocationsApi(settings.organizationUrl, [api.authHandler])
    const area = await locationsApi.getResourceArea('8a3d49b8-91f0-46ef-b33d-dda338c25db3')
    if (!area.locationUrl) {
      throw new Error('Azure DevOps identity service URL is missing')
    }
    const url = new URL(`${area.locationUrl.replace(/\/$/, '')}/_apis/identities`)
    url.search = new URLSearchParams({
      identityIds: myself.id,
      queryMembership: 'ExpandedUp',
      'api-version': '7.1',
    }).toString()
    // ExpandedUp resolves transitive parents server-side, so no client-side graph traversal is needed.
    const memberships = await api.rest.get<{ value: { memberOf?: string[] }[] }>(url.toString())
    if (!memberships.result?.value) {
      throw new Error('Azure DevOps identity memberships are missing')
    }
    const descriptors = [...new Set(memberships.result.value[0]?.memberOf ?? [])]
    const teams = new Map<string, Identity>()
    // Bound query URLs when users belong to many groups.
    for (let index = 0; index < descriptors.length; index += 20) {
      url.search = new URLSearchParams({
        descriptors: descriptors.slice(index, index + 20).join(','),
        'api-version': '7.1',
      }).toString()
      const response = await api.rest.get<{ value: Identity[] }>(url.toString())
      if (!response.result?.value) {
        throw new Error('Azure DevOps team identities are missing')
      }
      for (const team of response.result.value) {
        if (team.id) {
          teams.set(team.id, team)
        }
      }
    }
    return [...teams.values()]
  }

  private static async loadPullRequestData(
    api: azdev.WebApi,
    settings: AzDoSettings,
    access = createAzureDevOpsAccess(settings.acknowledgedScopeRequirements)
  ): Promise<AzureDevOpsData> {
    const data: AzureDevOpsData = new AzureDevOpsData()
    data.access = access
    const previousCode = access.features.code

    try {
      let connectionData: ConnectionData
      try {
        connectionData = await this.connect(api)
      } catch (error) {
        for (const { id } of azureDevOpsRequirements) this.recordAccessFailure(access, id, error)
        throw error
      }
      data.myself = connectionData.authenticatedUser
      log.debug('Fetching data from Azure DevOps')
      const results = await Promise.allSettled([
        this.checkAccess(access, 'identity', () => this.loadMyTeams(api, settings, data.myself)),
        this.checkAccess(access, 'code', async () => {
          const git = await api.getGitApi(settings.organizationUrl, [api.authHandler])
          const prs = await git.getPullRequestsByProject(settings.project, { includeLinks: true, status: AzDoPrStatus.Active })
          // List responses truncate descriptions to 400 characters.
          await throttleAll(4, prs
            .filter((pr) => (pr.description?.length ?? 0) >= 400)
            .map((pr) => async () => {
              const full = await git.getPullRequest(pr.repository!.id!, pr.pullRequestId!, settings.project)
              pr.description = full.description
            }))
          return prs
        }),
      ])
      const [teams, prs] = results
      // A successful PR read alone cannot resolve a previous policy access denial.
      if (prs.status === 'fulfilled')
        access.features.code =
          previousCode.status === 'denied'
            ? previousCode
            : {
                status: 'unverified',
                message: 'PR read access verified. Policy access is not verified until a PR is available.',
              }
      if (teams.status === 'rejected') throw teams.reason
      if (prs.status === 'rejected') throw prs.reason
      data.teams = teams.value
      const azDoBuilds = prs.value
      data.items = azDoBuilds
        .map((pr) => AzureDevOpsService.mapPullRequests(pr, data))
        .toSorted((a, b) => {
          if (a.creationDate && b.creationDate) {
            return b.creationDate.getTime() - a.creationDate.getTime()
          }
          return 0
        })
      log.debug('Got pull requests from Azure DevOps', data.items.length)

      if (data.items.length)
        await this.checkAccess(access, 'code', () => AzureDevOpsService.enrichPolicyEvaluations(api, settings, data))
      log.debug('Got policy evaluations from Azure DevOps')

      log.debug('Completed to fetch data')
    } catch (error) {
      log.error('Failed to fetch data', getAzureDevOpsAccessFailure(error).message)
      if (error instanceof Error) {
        const statusCode = (error as AzError).statusCode ?? 0
        const errorType = statusCode === 401 ? ErrorType.Authentication : ErrorType.Unknown
        data.error = {
          message: error.message.replaceAll(settings.pat, '[redacted]'),
          details: getAzureDevOpsAccessFailure(error).message,
          type: errorType,
          actionText: 'DevOps Settings',
          actionHref: '/settings/azure-devops',
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
        description: pr.description ?? '',
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

    for (const evaluation of results) {
      const pr = data.items.find((pr) => pr.id === evaluation.prId)
      if (pr) {
        pr.evaluations = evaluation.evaluations
      }
    }
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
    teams: Identity[]
  ): Reviewer[] {
    if (!reviewers) {
      return []
    }

    const mappedReviewers: Reviewer[] = []

    // Group reviewers by their "voted for" status
    for (const rev of reviewers) {
      if (rev.votedFor && rev.votedFor.length > 0) {
        continue
      }

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
    }

    // Add the "voted for" reviewers
    for (const rev of reviewers) {
      if (!rev.votedFor || rev.votedFor.length === 0) {
        continue
      }
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

      for (const item of votedForItems) {
        item.reviewedBy = item.reviewedBy || []
        item.reviewedBy.push(mappedRev)
      }
    }

    return mappedReviewers
  }

  private async updateData(): Promise<void> {
    const revision = this.connectionRevision
    const data: PullRequestData = {
      items: [],
      error: null,
    }

    if (this.settings && this.api && this.isValidSettings(this.settings)) {
      loader.start()

      const access = structuredClone(
        this.pullRequests.access ?? createAzureDevOpsAccess(this.settings.acknowledgedScopeRequirements, revision)
      )
      const newData = await AzureDevOpsService.loadPullRequestData(this.api, this.settings, access)
      if (revision !== this.connectionRevision) {
        loader.stop()
        return
      }
      this.data = newData
      data.items = newData.items
      data.error = newData.error
      data.access = newData.access
      if (data.access && this.pullRequests.access) {
        data.access.acknowledged = this.pullRequests.access.acknowledged
        if (data.access.features.code.reason !== 'authentication')
          data.access.features.vote = this.pullRequests.access.features.vote
      }

      this.handleNewPRNotifications(data.items)
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
    this.publishData()
    loader.stop()
  }

  private handleNewPRNotifications(prs: PullRequest[]): void {
    try {
      NotificationService.getInstance().notifyNewPullRequests(prs)
    } catch (error) {
      log.error('Failed to send notification', error)
    }
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
  teams: Identity[] = []
  myself: Identity | undefined = undefined
  access?: AzureDevOpsAccess
}

interface AzError extends Error {
  statusCode: number
}
