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

  public notifyNewPullRequests(pullRequests: PullRequest[], profileId?: string): void {
    if (!this.settings?.enableNotifications) {
      return
    }

    // Filter PRs based on notification profiles if specified
    let filteredPRs = pullRequests
    if (this.settings.notificationProfiles && this.settings.notificationProfiles.length > 0) {
      // If specific profiles are selected and this update is for a profile
      if (profileId && !this.settings.notificationProfiles.includes(profileId)) {
        return
      }
    }

    // Find new PRs that haven't been notified yet
    const newPRs = filteredPRs.filter((pr) => !this.lastNotifiedPRIds.has(pr.id))

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

  public updateKnownPRs(pullRequests: PullRequest[]): void {
    // Update the set of known PRs without notifying
    pullRequests.forEach((pr) => this.lastNotifiedPRIds.add(pr.id))
  }

  public removePR(prId: number): void {
    // Remove a PR from the known set (e.g., when it's closed)
    this.lastNotifiedPRIds.delete(prId)
  }
}
