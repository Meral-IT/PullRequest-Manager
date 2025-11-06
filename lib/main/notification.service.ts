import { Notification } from 'electron'
import log from 'electron-log/main'
import { getTrayManager } from '../main/tray'
import { PrProfile } from '../models/pr-profile'
import { PullRequest } from '../models/pull-request.model'
import { GeneralSettings } from '../models/settings.model'
import { FilterEvaluator, PullRequestFilter } from '../models/ui-filter.model'

export class NotificationService {
  private static instance: NotificationService
  private lastNotificationTime: Date = new Date()
  private settings: GeneralSettings | null = null
  private filters: PullRequestFilter[] = []

  public static getInstance(): NotificationService {
    if (!this.instance) {
      this.instance = new NotificationService()
    }
    return this.instance
  }

  public setSettings(settings: GeneralSettings, profiles: PrProfile[]): void {
    this.settings = settings
    this.filters = profiles
      .filter(x => x.notifyOnNewPrs && x.filter)
      .map(x => x.filter!)
  }

  /**
   * Notify about new pull requests.
   * This method checks PR creation dates against the last notification time
   * to determine which PRs are new and should trigger notifications.
   * 
   * @param pullRequests - Array of pull requests to potentially notify about
   */
  public notifyNewPullRequests(pullRequests: PullRequest[]): void {
    this.updateTrayIcon(pullRequests)

    if (!this.settings?.enableNotifications) {
      return
    }

    // Find new PRs created after the last notification time
    const newPRs = pullRequests.filter((pr) => {
      // If creationDate is not available, treat as handled
      if (!pr.creationDate) {
        return false
      }
      return pr.creationDate > this.lastNotificationTime
        && FilterEvaluator.evaluateProfiles(pr, this.filters)
    })

    if (newPRs.length === 0) {
      return
    }

    // Update the last notification time to now
    this.lastNotificationTime = new Date()

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
      silent: !(this.settings?.notificationSound ?? false),
    })

    notification.show()
  }

  private hasMatchingPRsForNotification(pullRequests: PullRequest[]): boolean {
    if (this.filters.length === 0 || pullRequests.length === 0) {
      return false
    }

    if (this.filters.length === 0) {
      return false
    }

    // Check if any PR matches any of the notify filters
    return pullRequests.some(f =>
      FilterEvaluator.evaluateProfiles(f, this.filters)
    )
  }

  private updateTrayIcon(pullRequests: PullRequest[]): void {
    const trayManager = getTrayManager()
    if (trayManager) {
      const hasMatchingPRs = this.hasMatchingPRsForNotification(pullRequests)
      trayManager.setActiveState(hasMatchingPRs)
    }
  }

  public reset(): void {
    // Reset the notification time when data is manually refreshed
    // Set to current time to prevent notifications for existing PRs
    this.lastNotificationTime = new Date()
  }

  /**
   * Initialize the notification service with existing PRs.
   * This should be called during initial load to set the baseline
   * notification time and prevent notifications for existing PRs.
   */
  public initialize(pullRequests: PullRequest[]): void {
    // Set the last notification time to the most recent PR creation date
    // or current time if no PRs exist, to prevent initial notifications
    const mostRecentCreationDate = pullRequests
      .filter(pr => pr.creationDate)
      .map(pr => pr.creationDate!)
      .reduce((latest, current) => current > latest ? current : latest, new Date(0))

    this.lastNotificationTime = mostRecentCreationDate > new Date(0)
      ? mostRecentCreationDate
      : new Date()
  }
}
