import { PullRequestActionResult, pullRequestActionMessage } from '@/lib/models/pull-request-action'
import { PullRequest } from '@/lib/models/pull-request.model'
import { useRef, useState } from 'react'

export function usePrVoteAction() {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ message: string; intent: 'success' | 'warning' | 'error' } | null>(null)

  const run = async (action: 'approve' | 'reset', items: PullRequest[]) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setNotice(null)
    try {
      const result: PullRequestActionResult = await globalThis.api.invoke(
        action === 'approve' ? 'approve-prs' : 'reset-pr-feedback',
        action === 'approve' ? items : items[0]
      )
      setNotice({
        message: pullRequestActionMessage(result, action),
        intent: result.failed ? 'error' : result.skipped ? 'warning' : 'success',
      })
    } catch {
      setNotice({
        message: 'Unable to update pull request votes. Check your connection and try again.',
        intent: 'error',
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return { pending, notice, run }
}
