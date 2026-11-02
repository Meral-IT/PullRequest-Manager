export type PullRequestActionResult = {
  succeeded: number
  skipped: number
  failed: number
  error?: string
}

export function pullRequestActionMessage(result: PullRequestActionResult, action: 'approve' | 'reset'): string {
  return `${result.succeeded} ${action === 'approve' ? 'approved' : result.succeeded === 1 ? 'vote reset' : 'votes reset'}, ${result.skipped} skipped, ${result.failed} failed.${result.error ? ` ${result.error}` : ''}`
}
