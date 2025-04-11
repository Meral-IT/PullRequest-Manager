import { PrVote } from './pr-vote'
import { PullRequest, Reviewer } from './pull-request.model'
import { User } from './user.model'

export interface PullRequestFilter extends CombinationFilter<FilterNode> {}

export interface FilterNode {
  author?: CombinationFilter<UserFilter>
  reviewers?: CombinationFilter<ReviewerFilter>
  isDraft?: boolean
}

export interface UserFilter {
  label?: string
  id?: string
  isBot?: boolean
  isMySelf?: boolean
}

export interface ReviewerFilter {
  user?: UserFilter
  isRequired?: boolean
  vote?: PrVote
}

export interface CombinationFilter<TFilter> {
  op: 'AND' | 'OR'
  filters: TFilter[]
}

export class FilterEvaluator {
  public static evaluate(data: PullRequest[], filter: PullRequestFilter): PullRequest[] {
    return data.filter((pr) => this.evaluatePullRequest(pr, filter))
  }

  private static evaluatePullRequest(pr: PullRequest, filter: PullRequestFilter): boolean {
    return filter.op === 'AND'
      ? filter.filters.every((f) => this.evaluatePullRequestFilter(pr, f))
      : filter.filters.some((f) => this.evaluatePullRequestFilter(pr, f))
  }

  private static evaluatePullRequestFilter(pr: PullRequest, filter: FilterNode): boolean {
    return (
      ((!filter.author || this.evaluateAuthor(pr, filter.author)) &&
        (!filter.reviewers || this.evaluateReviewers(pr, filter.reviewers)) &&
        (filter.isDraft === undefined || pr.isDraft === filter.isDraft)) ??
      false
    )
  }

  private static evaluateAuthor(pr: PullRequest, filter: CombinationFilter<UserFilter>): boolean {
    return filter.op === 'AND'
      ? filter.filters.every((f) => this.evaluateUser(pr.author, f))
      : filter.filters.some((f) => this.evaluateUser(pr.author, f))
  }

  private static evaluateReviewers(pr: PullRequest, filter: CombinationFilter<ReviewerFilter>): boolean {
    return filter.op === 'AND'
      ? filter.filters.every((f) => pr.reviewers.some((r) => this.evaluateReviewer(r, f)))
      : filter.filters.some((f) => pr.reviewers.some((r) => this.evaluateReviewer(r, f)))
  }

  private static evaluateReviewer(reviewer: Reviewer, filter: ReviewerFilter): boolean {
    return (
      ((!filter.user || this.evaluateUser(reviewer.user, filter.user)) &&
        (!filter.isRequired || reviewer.isRequired) &&
        (!filter.vote || reviewer.vote === filter.vote)) ??
      false
    )
  }

  private static evaluateUser(user: User, filter: UserFilter): boolean {
    return (
      ((!filter.label || user.label === filter.label) &&
        (!filter.id || user.id === filter.id) &&
        (!filter.isMySelf || user.isMySelf === filter.isMySelf) &&
        (!filter.isBot || user?.isBot)) ??
      false
    )
  }
}
