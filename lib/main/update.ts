import { app, BrowserWindow, Notification } from 'electron'
import log from 'electron-log/main'
import electronUpdater, { ProgressInfo, UpdateDownloadedEvent, UpdateInfo, type AppUpdater } from 'electron-updater'
import getOrCreateAppWindow, { showWindow } from './app'

export class PullRequestUpdateManager {
  private static instance: PullRequestUpdateManager | null = null
  private updater?: electronUpdater.AppUpdater

  public static getInstance(): PullRequestUpdateManager {
    this.instance ??= new PullRequestUpdateManager()
    return this.instance
  }

  private getUpdater(): electronUpdater.AppUpdater {
    this.updater ??= this.getAutoUpdater()
    return this.updater
  }

  public async checkForUpdates(): Promise<void> {
    log.info('Checking for updates...')

    await this.getUpdater().checkForUpdates()
  }

  public async downloadUpdate(): Promise<void> {
    log.info('Downloading update...')
    await this.getUpdater().downloadUpdate()

    this.getUpdater().quitAndInstall(true, true)
  }

  private getAutoUpdater(): AppUpdater {
    // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
    // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
    const { autoUpdater } = electronUpdater

    autoUpdater.logger = log
    autoUpdater.disableWebInstaller = true
    autoUpdater.autoDownload = false
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info('Update available:', info)

      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('update:update-available', info)
      }

      const NOTIFICATION_TITLE = 'Update available'
      const NOTIFICATION_BODY = 'Click to view the release notes'

      const desktopNotification = new Notification({
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
        closeButtonText: 'Close',
      })

      desktopNotification.on('click', (_) => {
        const appWindow = getOrCreateAppWindow()
        showWindow()
        appWindow.webContents.send('update:show-releaseNotes')
      })

      desktopNotification.show()
    })

    autoUpdater.on('download-progress', (info: ProgressInfo) => {
      log.info('Download progress:', info)

      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('update:download-progress', info)
      }
    })

    autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      log.info('Update downloaded:', info)
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('update:update-downloaded', info)
      }
    })

    return autoUpdater
  }
}
