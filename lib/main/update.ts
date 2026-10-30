import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, Notification } from 'electron'
import log from 'electron-log/main'
import electronUpdater, { ProgressInfo, UpdateDownloadedEvent, UpdateInfo, type AppUpdater } from 'electron-updater'
import type { UpdateState } from '../models/update-state'
import getOrCreateAppWindow, { showWindow } from './app'

class ManualNsisUpdater extends electronUpdater.NsisUpdater {
  public override quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    // The manager guards concurrent attempts; NSIS must also permit a retry after an asynchronous launch failure.
    this.quitAndInstallCalled = false
    super.quitAndInstall(isSilent, isForceRunAfter)
  }
}

export class PullRequestUpdateManager {
  private static instance: PullRequestUpdateManager | null = null
  private updater?: electronUpdater.AppUpdater
  private state: UpdateState = { status: 'idle' }
  private downloadTask?: Promise<void>
  private quittingForUpdate = false

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

  public getState(): UpdateState {
    return this.state
  }

  public isQuittingForUpdate(): boolean {
    return this.quittingForUpdate
  }

  private publish(state: UpdateState): void {
    this.state = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('update:state-changed', state)
    }
  }

  public downloadUpdate(): Promise<void> {
    if (this.downloadTask) return this.downloadTask
    const state = this.state
    if (state.status !== 'available' && !(state.status === 'error' && state.operation === 'download')) {
      return Promise.reject(new Error('No update available to download'))
    }
    log.info('Downloading update...')
    this.publish({ status: 'downloading', info: state.info })
    this.downloadTask = Promise.resolve()
      .then(() => this.getUpdater().downloadUpdate())
      .then(() => undefined)
      .catch((error: unknown) => {
        if (this.state.status === 'downloading') {
          this.publish({ status: 'error', info: state.info, operation: 'download' })
        }
        throw error
      })
      .finally(() => {
        this.downloadTask = undefined
      })
    return this.downloadTask
  }

  public installUpdate(): void {
    const state = this.state
    if (state.status === 'installing') return
    if (state.status !== 'ready' && !(state.status === 'error' && state.operation === 'install')) {
      throw new Error('Update is not ready to install')
    }
    this.publish({ status: 'installing', info: state.info })
    try {
      this.getUpdater().quitAndInstall(true, true)
    } catch (error) {
      this.publish({ status: 'error', info: state.info, operation: 'install' })
      throw error
    }
  }

  private getAutoUpdater(): AppUpdater {
    // electron-updater is CommonJS; keep the default import for ESM compatibility.
    const autoUpdater = process.platform === 'win32' ? new ManualNsisUpdater() : electronUpdater.autoUpdater

    nativeAutoUpdater.on('before-quit-for-update', () => {
      this.quittingForUpdate = this.state.status === 'installing'
      if (this.state.status === 'error' && this.state.operation === 'install') {
        // NSIS queues quit before its asynchronous launch result; keep the recovery panel open if launch failed.
        app.once('before-quit', (event) => event.preventDefault())
      }
    })

    autoUpdater.logger = log
    autoUpdater.disableWebInstaller = true
    autoUpdater.autoDownload = false
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('error', (error: Error) => {
      log.error('Auto updater failed', error)
      const state = this.state
      if (state.status === 'downloading' || state.status === 'installing') {
        this.quittingForUpdate = false
        this.publish({
          status: 'error',
          info: state.info,
          operation: state.status === 'downloading' ? 'download' : 'install',
        })
      }
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info('Update available:', info)

      if (this.state.status !== 'idle' && this.state.status !== 'available') return
      this.publish({ status: 'available', info })

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
      if (this.state.status === 'downloading') {
        this.publish({ ...this.state, progress: info })
      }
    })

    autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      log.info('Update downloaded:', info)
      if (this.state.status === 'downloading') this.publish({ status: 'ready', info })
    })

    return autoUpdater
  }
}
