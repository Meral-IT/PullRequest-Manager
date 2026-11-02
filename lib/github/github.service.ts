import {
  GitHubIntegration,
  normalizeRepositories,
  sameIntegrationConnection,
  validGitHubRepository,
} from '../models/settings.model'
import { createGitHubAccess, GitHubAccess, GitHubFeature, GitHubValidationResult } from '../models/github-access'
import { ErrorDetail, ErrorType } from '../models/error-detail'
import {
  PullRequest,
  PullRequestMergeStatus,
  PullRequestPolicyEvaluationStatus as CheckStatus,
  Reviewer,
  pullRequestKey,
} from '../models/pull-request.model'
import { PrVote } from '../models/pr-vote'
import { User } from '../models/user.model'
import loader from '../tools/loading.service'
import { createHash } from 'node:crypto'

type GitHubUser = { id: number; login: string; type?: string; avatar_url?: string }
type GitHubTeam = { id: number; name: string; slug: string; organization?: { login: string } }
type GitHubRepository = { id: number; name: string; full_name: string; owner: GitHubUser }
type GitHubPullRequest = {
  number: number
  title: string
  body: string | null
  user: GitHubUser
  draft: boolean
  state: string
  created_at: string
  updated_at: string
  html_url: string
  mergeable: boolean | null
  base: { ref: string; repo: GitHubRepository }
  head: { ref: string; sha: string }
}
type GitHubReview = { id: number; user: GitHubUser | null; state: string }
type GitHubCheck = { id: number; name: string; status: string; conclusion: string | null; details_url?: string }
type GitHubStatus = { id: number; context: string; state: string; target_url?: string }
export type GitHubPullRequestData = { items: PullRequest[]; error: ErrorDetail | null; access: GitHubAccess }
type CachedResponse = { etag: string; body: unknown; link: string | null }
type RequestSchedule = { requests: Promise<void>; retryAt: number; lastWrite: number }
class GitHubError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly rateLimited = false
  ) {
    super(message)
  }
}

export class GitHubService {
  private static readonly requestSchedules = new Map<string, RequestSchedule>()
  private settings?: GitHubIntegration
  private data: GitHubPullRequestData = { items: [], error: null, access: createGitHubAccess() }
  private myself?: GitHubUser
  private revision = 0
  private active = false
  private timer?: ReturnType<typeof setTimeout>
  private pollGeneration = 0
  private myTeams: GitHubTeam[] = []
  private refresh?: { revision: number; promise: Promise<void> }
  private controller = new AbortController()
  private requestSchedule?: RequestSchedule
  private readonly cache = new Map<string, CachedResponse>()
  private resources = new Map<string, string>()

  constructor(private readonly onData: () => void) {}

  public getPullRequests(): GitHubPullRequestData {
    return this.data
  }

  public setConfiguration(input: GitHubIntegration): void {
    const settings = { ...input, repositories: normalizeRepositories(input.repositories) }
    if (!this.settings || !sameIntegrationConnection(this.settings, settings)) {
      this.revision++
      this.controller.abort()
      this.controller = new AbortController()
      this.cache.clear()
      this.resources.clear()
      this.myself = undefined
      this.data = { items: [], error: null, access: createGitHubAccess() }
    }
    this.settings = settings
    const credentialKey = createHash('sha256').update(settings.pat).digest('hex')
    let schedule = GitHubService.requestSchedules.get(credentialKey)
    if (!schedule) {
      schedule = { requests: Promise.resolve(), retryAt: 0, lastWrite: 0 }
      GitHubService.requestSchedules.set(credentialKey, schedule)
    }
    this.requestSchedule = schedule
    this.pollGeneration++
    clearTimeout(this.timer)
    if (this.active) this.schedule(0)
  }

  public start(): void {
    if (this.active) return
    this.active = true
    this.schedule(0)
  }

  public stop(): void {
    this.active = false
    this.pollGeneration++
    clearTimeout(this.timer)
    this.revision++
    this.controller.abort()
    this.controller = new AbortController()
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer)
    const generation = this.pollGeneration
    this.timer = setTimeout(() => {
      if (generation !== this.pollGeneration || !this.active) return
      void this.updateDataImmediately().finally(() => {
        if (this.active && generation === this.pollGeneration)
          this.schedule(
            Math.max((this.settings?.updateInterval ?? 180) * 1000, (this.requestSchedule?.retryAt ?? 0) - Date.now())
          )
      })
    }, delay)
  }

  private configured(): boolean {
    return (
      !!this.settings?.pat &&
      !!this.settings.repositories.length &&
      this.settings.repositories.every(validGitHubRepository)
    )
  }

  public async updateDataImmediately(): Promise<void> {
    const revision = this.revision
    if (this.refresh) {
      const current = this.refresh
      await current.promise
      if (revision !== this.revision) return
      if (current.revision === revision) return
      return this.updateDataImmediately()
    }
    if (!this.configured()) {
      this.data = {
        items: [],
        access: createGitHubAccess(),
        error: this.error(
          'Configuration required',
          'Enter a PAT and at least one owner/repository name.',
          ErrorType.ConfigurationRequired
        ),
      }
      this.onData()
      return
    }
    const promise = this.load(revision)
    this.refresh = { revision, promise }
    try {
      await promise
    } finally {
      if (this.refresh?.promise === promise) this.refresh = undefined
    }
  }

  public async validateConnection(settings: GitHubIntegration): Promise<GitHubValidationResult> {
    if (this.settings && sameIntegrationConnection(this.settings, settings)) {
      await this.updateDataImmediately()
      return {
        userDisplayName: this.myself?.login ?? null,
        error: this.data.error?.details ?? null,
        access: this.data.access,
      }
    }
    const revision = this.revision
    const probe = new GitHubService(() => {})
    probe.setConfiguration(settings)
    await probe.updateDataImmediately()
    const result = {
      userDisplayName: probe.myself?.login ?? null,
      error: probe.data.error?.details ?? null,
      access: probe.data.access,
    }
    probe.stop()
    if (revision === this.revision && this.settings && sameIntegrationConnection(this.settings, settings)) {
      result.access.features.approval = this.data.access.features.approval
      this.data = { ...this.data, access: result.access }
      this.onData()
    }
    return result
  }

  private error(message: string, details: string, type = ErrorType.Unknown): ErrorDetail {
    return {
      message,
      details,
      type,
      actionHref: `/settings/integrations/${this.settings?.id ?? ''}`,
      actionText: 'GitHub settings',
    }
  }

  private async request<T>(
    resource: string,
    revision: number,
    method = 'GET',
    body?: unknown
  ): Promise<{ body: T; link: string | null }> {
    const url = new URL(resource, 'https://api.github.com')
    if (url.origin !== 'https://api.github.com' || url.username || url.password)
      throw new GitHubError('Refused an unexpected GitHub API URL.')
    const settings = this.settings!
    const signal = this.controller.signal
    const schedule = this.requestSchedule!
    const operation = schedule.requests.then(async () => {
      if (revision !== this.revision || signal.aborted)
        throw new GitHubError('Connection changed. Refresh and try again.')
      if (Date.now() < schedule.retryAt)
        throw new GitHubError('GitHub rate limit reached. Retry after the current cooldown.')
      if (method !== 'GET') {
        const wait = schedule.lastWrite + 1000 - Date.now()
        if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
        if (revision !== this.revision) throw new GitHubError('Connection changed. Refresh and try again.')
        schedule.lastWrite = Date.now()
      }
      const cached = this.cache.get(url.href)
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${settings.pat}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'PullRequest-Manager',
      }
      if (method === 'GET' && cached) headers['If-None-Match'] = cached.etag
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      let response: Response
      try {
        let destination = url
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        for (let redirects = 0; ; redirects++) {
          response = await fetch(destination, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: 'manual',
            signal: requestSignal,
          })
          if (![301, 302, 307, 308].includes(response.status)) break
          const location = response.headers.get('location')
          if (!location || redirects === 5) throw new GitHubError('GitHub returned an invalid redirect.')
          destination = new URL(location, destination)
          if (destination.origin !== url.origin || destination.username || destination.password)
            throw new GitHubError('Refused an unexpected GitHub API redirect.')
        }
      } catch (error) {
        if (error instanceof GitHubError) throw error
        throw new GitHubError(
          signal.aborted
            ? 'Connection changed. Refresh and try again.'
            : 'GitHub request failed or timed out. Check your connection.'
        )
      }
      if (revision !== this.revision) throw new GitHubError('Connection changed. Refresh and try again.')
      if (response.status === 304 && cached) return { body: cached.body as T, link: cached.link }
      if (!response.ok) {
        const errorBody = await response.json().catch(() => undefined)
        const secondaryLimit = typeof errorBody?.message === 'string' && /rate limit/i.test(errorBody.message)
        if (
          response.status === 429 ||
          (response.status === 403 &&
            (secondaryLimit ||
              response.headers.has('retry-after') ||
              response.headers.get('x-ratelimit-remaining') === '0'))
        ) {
          const retry = response.headers.get('retry-after')
          const retryMs = retry
            ? Number.isFinite(Number(retry))
              ? Date.now() + Number(retry) * 1000
              : Date.parse(retry)
            : 0
          const resetMs = Number(response.headers.get('x-ratelimit-reset')) * 1000
          schedule.retryAt = Math.max(Date.now() + 60_000, Number.isFinite(retryMs) ? retryMs : 0, resetMs || 0)
          throw new GitHubError('GitHub rate limit reached. Retry after the current cooldown.', response.status, true)
        }
        const message =
          response.status === 401
            ? 'GitHub authentication failed. Check the PAT.'
            : response.status === 403
              ? 'GitHub access denied. Check token permissions and repository rules.'
              : response.status === 404
                ? 'GitHub resource not found or unavailable to this token.'
                : `GitHub request failed (${response.status}). Refresh and try again.`
        throw new GitHubError(message, response.status)
      }
      let payload: T
      try {
        payload = response.status === 204 ? (undefined as T) : ((await response.json()) as T)
      } catch {
        throw new GitHubError('GitHub returned an invalid response.')
      }
      const link = response.headers.get('link')
      const etag = response.headers.get('etag')
      if (method === 'GET' && etag) this.cache.set(url.href, { etag, body: payload, link })
      else if (method === 'GET') this.cache.delete(url.href)
      if (method !== 'GET') this.cache.clear()
      return { body: payload, link }
    })
    schedule.requests = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async pages<T>(resource: string, revision: number, field?: 'check_runs' | 'statuses'): Promise<T[]> {
    const url = new URL(resource, 'https://api.github.com')
    url.searchParams.set('per_page', '100')
    let next: string | undefined = url.href
    const seen = new Set<string>()
    const items: T[] = []
    while (next) {
      if (seen.has(next)) throw new GitHubError('GitHub returned a repeated pagination page.')
      seen.add(next)
      const response = await this.request<T[] | Record<string, T[]>>(next, revision)
      const page = field ? response.body[field] : response.body
      if (!Array.isArray(page)) throw new GitHubError('GitHub returned an invalid list response.')
      items.push(...page)
      next = response.link?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
    }
    return items
  }

  private async load(revision: number): Promise<void> {
    const settings = this.settings!
    const access = createGitHubAccess()
    access.features.approval = this.data.access.features.approval
    const failures: string[] = []
    const failedFeatures = new Set<GitHubFeature>()
    const read = async <T>(
      feature: GitHubFeature,
      label: string,
      operation: () => Promise<T>
    ): Promise<T | undefined> => {
      try {
        const value = await operation()
        if (!failedFeatures.has(feature))
          access.features[feature] = { status: 'verified', message: 'Access verified for the configured repositories.' }
        return value
      } catch (error) {
        failedFeatures.add(feature)
        const denied = error instanceof GitHubError && !error.rateLimited && [403, 404].includes(error.statusCode ?? 0)
        const message = error instanceof GitHubError ? error.message : 'GitHub returned incomplete data.'
        if (access.features[feature].status !== 'denied')
          access.features[feature] = { status: denied ? 'denied' : 'unverified', message: `${label}: ${message}` }
        failures.push(`${label}: ${message}`)
        return undefined
      }
    }
    loader.start()
    try {
      const myself = (await this.request<GitHubUser>('/user', revision)).body
      if (!myself?.id || !myself.login) throw new GitHubError('GitHub authentication failed. Check the PAT.', 401)
      const teams = await read('teams', 'Team membership', () => this.pages<GitHubTeam>('/user/teams', revision))
      const items: PullRequest[] = []
      const resources = new Map<string, string>()
      for (const repository of settings.repositories) {
        const resource = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`
        const repo = await read('pullRequests', repository, async () => {
          const metadata = (await this.request<GitHubRepository>(resource, revision)).body
          if (!metadata?.id || !metadata.owner?.id || !metadata.name)
            throw new GitHubError('GitHub returned invalid repository metadata.')
          return metadata
        })
        if (!repo) continue
        const prs = await read('pullRequests', repository, () =>
          this.pages<GitHubPullRequest>(`${resource}/pulls?state=open`, revision)
        )
        for (const listed of prs ?? []) {
          const prResource = `${resource}/pulls/${listed.number}`
          const detail = await read(
            'pullRequests',
            `${repository} #${listed.number}`,
            async () => (await this.request<GitHubPullRequest>(prResource, revision)).body
          )
          const raw = detail ?? listed
          if (raw.state !== 'open') continue
          const reviews = await read('reviews', `${repository} #${raw.number} reviews`, () =>
            this.pages<GitHubReview>(`${prResource}/reviews`, revision)
          )
          const requested = await read(
            'reviews',
            `${repository} #${raw.number} reviewers`,
            async () =>
              (
                await this.request<{ users: GitHubUser[]; teams: GitHubTeam[] }>(
                  `${prResource}/requested_reviewers`,
                  revision
                )
              ).body
          )
          const checks = await read('checks', `${repository} #${raw.number} checks`, () =>
            this.pages<GitHubCheck>(
              `${resource}/commits/${encodeURIComponent(raw.head.sha)}/check-runs?filter=latest`,
              revision,
              'check_runs'
            )
          )
          const statuses = await read('statuses', `${repository} #${raw.number} statuses`, () =>
            this.pages<GitHubStatus>(
              `${resource}/commits/${encodeURIComponent(raw.head.sha)}/status`,
              revision,
              'statuses'
            )
          )
          const reviewerMap = new Map<string, Reviewer>()
          for (const user of requested?.users ?? [])
            reviewerMap.set(String(user.id), { user: this.user(user, myself), vote: PrVote.NoVote, reviewedBy: [] })
          for (const review of reviews ?? []) {
            if (!review.user) continue
            const id = String(review.user.id)
            if (!reviewerMap.has(id))
              reviewerMap.set(id, { user: this.user(review.user, myself), vote: PrVote.NoVote, reviewedBy: [] })
            if (review.state === 'APPROVED') reviewerMap.get(id)!.vote = PrVote.Approved
            if (review.state === 'CHANGES_REQUESTED') reviewerMap.get(id)!.vote = PrVote.Rejected
          }
          for (const team of requested?.teams ?? [])
            reviewerMap.set(`team:${team.id}`, {
              user: {
                id: `team:${team.id}`,
                label: team.name || team.slug,
                isMySelf: teams?.some((member) => member.id === team.id) ?? false,
              },
              vote: PrVote.NoVote,
              reviewedBy: [],
            })
          const evaluations = (checks ?? []).map((check) =>
            this.check(
              `check:${check.id}`,
              check.name,
              check.details_url,
              check.status !== 'completed'
                ? check.status === 'in_progress'
                  ? CheckStatus.Running
                  : CheckStatus.Queued
                : check.conclusion === 'success'
                  ? CheckStatus.Approved
                  : ['neutral', 'skipped'].includes(check.conclusion ?? '')
                    ? CheckStatus.NotApplicable
                    : CheckStatus.Rejected
            )
          )
          const contexts = new Set<string>()
          for (const status of statuses ?? []) {
            if (contexts.has(status.context)) continue
            contexts.add(status.context)
            evaluations.push(
              this.check(
                `status:${status.id}`,
                status.context,
                status.target_url,
                status.state === 'success'
                  ? CheckStatus.Approved
                  : status.state === 'pending'
                    ? CheckStatus.Queued
                    : CheckStatus.Rejected
              )
            )
          }
          const reviewersUnavailable = !reviews || !requested
          const myReviews = (reviews ?? []).filter(
            (review) => review.user?.id === myself.id && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)
          )
          const eligible =
            !settings.intelligentApproval ||
            (!!requested &&
              ((requested.users.length === 0 && requested.teams.length === 0) ||
                reviewerMap.get(String(myself.id)) !== undefined ||
                requested.teams.some((team) => teams?.some((member) => member.id === team.id))))
          items.push({
            id: raw.number,
            provider: 'github',
            headCommitId: raw.head.sha,
            author: this.user(raw.user, myself),
            creationDate: new Date(raw.created_at),
            lastUpdated: { label: 'Updated', timestamp: new Date(raw.updated_at).getTime() },
            details: {
              label: raw.title,
              description: raw.body ?? '',
              number: raw.number,
              repositoryId: String(repo.id),
              repository: repo.name,
              projectId: String(repo.id),
              project: repo.name,
              organizationId: String(repo.owner.id),
              organization: repo.owner.login,
              organizationUrl: `https://github.com/${repo.owner.login}`,
              branch: raw.head.ref,
              targetBranch: raw.base.ref,
              isDraft: raw.draft,
              isConflict: detail?.mergeable === false,
            },
            reviewers: [...reviewerMap.values()],
            isDraft: raw.draft,
            urls: { web: raw.html_url },
            mergeStatus: detail?.mergeable === false ? PullRequestMergeStatus.Conflicts : PullRequestMergeStatus.NotSet,
            evaluations,
            reviewersUnavailable,
            checksUnavailable: !checks || !statuses,
            canApprove:
              !reviewersUnavailable &&
              raw.user.id !== myself.id &&
              eligible &&
              reviewerMap.get(String(myself.id))?.vote !== PrVote.Approved,
            canResetFeedback: !reviewersUnavailable && myReviews.length > 0,
          })
          resources.set(pullRequestKey(items[items.length - 1]), prResource)
        }
      }
      if (revision !== this.revision) return
      this.myself = myself
      this.myTeams = teams ?? []
      this.resources = resources
      this.data = {
        items,
        access,
        error: failures.length ? this.error('GitHub access incomplete', failures.join('\n')) : null,
      }
    } catch (error) {
      if (revision !== this.revision) return
      this.data = {
        items: [],
        access,
        error: this.error(
          'Unable to load GitHub pull requests',
          error instanceof GitHubError ? error.message : 'GitHub returned incomplete data.',
          error instanceof GitHubError && error.statusCode === 401 ? ErrorType.Authentication : ErrorType.Unknown
        ),
      }
    } finally {
      loader.stop()
    }
    if (revision === this.revision) this.onData()
  }

  private user(user: GitHubUser, myself: GitHubUser): User {
    return {
      id: String(user.id),
      label: user.login,
      imageUrl: user.avatar_url,
      isBot: user.type === 'Bot',
      isMySelf: user.id === myself.id,
    }
  }

  private check(id: string, name: string, url: string | undefined, status: CheckStatus) {
    return { id, displayName: name, status, config: { type: { id, displayName: name, url: url ?? '' } } }
  }

  private resource(pr: PullRequest): string {
    const resource = this.resources.get(pullRequestKey(pr))
    if (!resource) throw new GitHubError('Repository is no longer configured. Refresh and try again.')
    return resource
  }

  public async approvePullRequests(prs: PullRequest[]): Promise<void> {
    const revision = this.revision
    const failures: string[] = []
    let denied = false
    for (const selected of prs) {
      const current = this.data.items.find((item) => pullRequestKey(item) === pullRequestKey(selected))
      if (!current) continue
      try {
        if (selected.headCommitId !== current.headCommitId)
          throw new GitHubError('The pull request changed. Refresh before approving.')
        const resource = this.resource(current)
        const raw = (await this.request<GitHubPullRequest>(resource, revision)).body
        if (raw.head.sha !== selected.headCommitId || raw.state !== 'open')
          throw new GitHubError('The pull request changed. Refresh before approving.')
        if (!current.canApprove || raw.user.id === this.myself?.id) continue
        const reviews = await this.pages<GitHubReview>(`${resource}/reviews`, revision)
        const latest = reviews
          .filter(
            (review) => review.user?.id === this.myself?.id && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)
          )
          .at(-1)
        if (latest?.state === 'APPROVED') continue
        if (this.settings?.intelligentApproval) {
          const requested = (
            await this.request<{ users: GitHubUser[]; teams: GitHubTeam[] }>(
              `${resource}/requested_reviewers`,
              revision
            )
          ).body
          if (
            (requested.users.length || requested.teams.length) &&
            !reviews.some((review) => review.user?.id === this.myself?.id) &&
            !requested.users.some((user) => user.id === this.myself?.id) &&
            !requested.teams.some((team) => this.myTeams.some((member) => member.id === team.id))
          )
            continue
        }
        await this.request(`${resource}/reviews`, revision, 'POST', {
          event: 'APPROVE',
          commit_id: selected.headCommitId,
        })
        if (revision !== this.revision) return
        this.data.access.features.approval = { status: 'verified', message: 'Review access verified.' }
      } catch (error) {
        denied ||= error instanceof GitHubError && !error.rateLimited && [403, 404].includes(error.statusCode ?? 0)
        failures.push(
          `#${current.id}: ${error instanceof GitHubError ? error.message : 'Unable to approve this pull request.'}`
        )
      }
    }
    if (revision !== this.revision) return
    await this.refreshAfterAction(revision)
    if (revision !== this.revision) return
    this.publishActionFailures(failures, denied)
  }

  public async resetPullRequestFeedback(selected: PullRequest): Promise<void> {
    const revision = this.revision
    const current = this.data.items.find((item) => pullRequestKey(item) === pullRequestKey(selected))
    if (!current) return
    const failures: string[] = []
    let denied = false
    try {
      const resource = this.resource(current)
      const reviews = await this.pages<GitHubReview>(`${resource}/reviews`, revision)
      for (const review of reviews) {
        if (review.user?.id !== this.myself?.id || !['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)) continue
        try {
          await this.request(`${resource}/reviews/${review.id}/dismissals`, revision, 'PUT', {
            message: 'Review reset via PullRequest-Manager.',
          })
          if (revision === this.revision)
            this.data.access.features.approval = { status: 'verified', message: 'Review access verified.' }
        } catch (error) {
          denied ||= error instanceof GitHubError && !error.rateLimited && [403, 404].includes(error.statusCode ?? 0)
          failures.push(error instanceof GitHubError ? error.message : 'Unable to dismiss your review.')
        }
      }
    } catch (error) {
      failures.push(error instanceof GitHubError ? error.message : 'Unable to dismiss your review.')
    }
    if (revision !== this.revision) return
    await this.refreshAfterAction(revision)
    if (revision !== this.revision) return
    this.publishActionFailures(failures, denied)
  }

  private publishActionFailures(failures: string[], denied: boolean): void {
    if (failures.length) {
      const message = failures.join('\n')
      this.data.access.features.approval = {
        status: denied || this.data.access.features.approval.status === 'denied' ? 'denied' : 'unverified',
        message,
      }
      this.data.error = this.error('GitHub review action failed', message)
      this.onData()
      throw new Error(message)
    }
    this.onData()
  }

  private async refreshAfterAction(revision: number): Promise<void> {
    await this.refresh?.promise
    if (revision === this.revision) await this.updateDataImmediately()
  }
}
