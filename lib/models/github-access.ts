export type GitHubFeature = 'pullRequests' | 'reviews' | 'checks' | 'statuses' | 'teams' | 'approval'
export type GitHubAccessResult = { status: 'verified' | 'denied' | 'unverified'; message: string }
export type GitHubAccess = { features: Record<GitHubFeature, GitHubAccessResult> }
export type GitHubValidationResult = { userDisplayName: string | null; error: string | null; access: GitHubAccess }

export function createGitHubAccess(): GitHubAccess {
  return {
    features: Object.fromEntries(
      ['pullRequests', 'reviews', 'checks', 'statuses', 'teams', 'approval'].map((feature) => [
        feature,
        {
          status: 'unverified',
          message:
            feature === 'approval'
              ? 'Verified only when you approve or dismiss your review. Validation makes no changes.'
              : 'Validate the connection to check access.',
        },
      ])
    ) as GitHubAccess['features'],
  }
}
