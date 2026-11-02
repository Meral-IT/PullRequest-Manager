export type PullRequestActionResult = {
  succeeded: number
  skipped: number
  failed: number
  error?: string
}

export function pullRequestActionMessage(result: PullRequestActionResult, action: 'approve' | 'reset'): string {
  let successLabel = 'approved'
  if (action === 'reset') successLabel = result.succeeded === 1 ? 'vote reset' : 'votes reset'
  const error = result.error ? ` ${result.error}` : ''
  return `${result.succeeded} ${successLabel}, ${result.skipped} skipped, ${result.failed} failed.${error}`
}
