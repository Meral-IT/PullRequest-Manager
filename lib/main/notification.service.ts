import { Notification } from 'electron'
import log from 'electron-log/main'
import { PullRequest } from '../models/pull-request.model'
import { GeneralSettings } from '../models/settings.model'

export class NotificationService {
  private static instance: NotificationService
  private lastNotifiedPRIds: Set<number> = new Set()
  private settings: GeneralSettings | null = null

  public static getInstance(): NotificationService {
    if (!this.instance) {
      this.instance = new NotificationService()
    }
    return this.instance
  }

  public setSettings(settings: GeneralSettings): void {
    this.settings = settings
  }

  /**
   * Notify about new pull requests.
   * This method tracks which PRs have already been notified to prevent duplicates,
   * even if called multiple times with the same PR.
   * 
   * @param pullRequests - Array of pull requests to potentially notify about
   */
  public notifyNewPullRequests(pullRequests: PullRequest[]): void {
    if (!this.settings?.enableNotifications) {
      return
    }

    // Find new PRs that haven't been notified yet
    const newPRs = pullRequests.filter((pr) => !this.lastNotifiedPRIds.has(pr.id))

    if (newPRs.length === 0) {
      return
    }

    // Update the set of notified PRs
    newPRs.forEach((pr) => this.lastNotifiedPRIds.add(pr.id))

    // Create notification
    this.showNotification(newPRs)
  }

  private showNotification(pullRequests: PullRequest[]): void {
    const count = pullRequests.length
    const title = count === 1 ? 'New Pull Request' : `${count} New Pull Requests`
    const body =
      count === 1
        ? `${pullRequests[0].author.label}: ${pullRequests[0].details.label}`
        : `You have ${count} new pull requests to review`

    log.debug('Showing notification:', title, body)

    const notification = new Notification({
      title,
      body,
      silent: !this.settings?.notificationSound,
    })

    notification.show()
  }

  public reset(): void {
    // Reset the notification state when data is manually refreshed
    this.lastNotifiedPRIds.clear()
  }

  /**
   * Update the set of known PRs without sending notifications.
   * This should be called during initial load to prevent notifications
   * for existing PRs.
   */
  public updateKnownPRs(pullRequests: PullRequest[]): void {
    // Update the set of known PRs without notifying
    pullRequests.forEach((pr) => this.lastNotifiedPRIds.add(pr.id))
  }

  /**
   * Remove a PR from the known set.
   * This can be called when a PR is closed or completed to allow
   * re-notification if it's reopened.
   */
  public removePR(prId: number): void {
    // Remove a PR from the known set (e.g., when it's closed)
    this.lastNotifiedPRIds.delete(prId)
  }
}
