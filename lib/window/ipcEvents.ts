import * as azdev from 'azure-devops-node-api'
import { app, type BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { AzureDevOpsService } from '../azure-devops/azure-devops.service'
import { NotificationService } from '../main/notification.service'
import { loadSettings, saveSettings } from '../main/settings'
import { PullRequestUpdateManager } from '../main/update'
import { PullRequest } from '../models/pull-request.model'

const execAsync = promisify(exec)

export const registerNativeThemeEventListeners = (allBrowserWindows: BrowserWindow[]) => {
  nativeTheme.addListener('updated', () => {
    for (const browserWindow of allBrowserWindows) {
      browserWindow.webContents.send('nativeThemeChanged')
    }
  })
}

const handleIPC = (channel: string, handler: (...args: any[]) => void) => {
  ipcMain.handle(channel, handler)
}
export const registerWindowIPC = (mainWindow: BrowserWindow) => {
  // Hide the menu bar
  mainWindow.setMenuBarVisibility(false)

  // Register window IPC
  handleIPC('init-window', () => {
    const { width, height } = mainWindow.getBounds()
    const minimizable = mainWindow.isMinimizable()
    const maximizable = mainWindow.isMaximizable()
    const platform = os.platform()

    return { width, height, minimizable, maximizable, platform }
  })

  handleIPC('is-window-minimizable', () => mainWindow.isMinimizable())
  handleIPC('is-window-maximizable', () => mainWindow.isMaximizable())
  handleIPC('window-minimize', () => mainWindow.minimize())
  handleIPC('window-maximize', () => mainWindow.maximize())
  handleIPC('window-close', () => mainWindow.close())
  handleIPC('window-maximize-toggle', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  handleIPC('app-exit', () => app.exit())

  const webContents = mainWindow.webContents
  handleIPC('web-undo', () => webContents.undo())
  handleIPC('web-redo', () => webContents.redo())
  handleIPC('web-cut', () => webContents.cut())
  handleIPC('web-copy', () => webContents.copy())
  handleIPC('web-paste', () => webContents.paste())
  handleIPC('web-delete', () => webContents.delete())
  handleIPC('web-select-all', () => webContents.selectAll())
  handleIPC('web-reload', () => webContents.reload())
  handleIPC('web-force-reload', () => webContents.reloadIgnoringCache())
  handleIPC('web-toggle-devtools', () => webContents.toggleDevTools())
  handleIPC('web-actual-size', () => webContents.setZoomLevel(0))
  handleIPC('web-zoom-in', () => webContents.setZoomLevel(webContents.zoomLevel + 0.5))
  handleIPC('web-zoom-out', () => webContents.setZoomLevel(webContents.zoomLevel - 0.5))
  handleIPC('web-toggle-fullscreen', () => mainWindow.setFullScreen(!mainWindow.fullScreen))
  handleIPC('web-open-url', (_e, url) => shell.openExternal(url))

  handleIPC('get-settings', async () => {
    // Load the settings from the store
    return loadSettings()
  })
  handleIPC('get-theme', async () => {
    // Load the settings from the store
    return (await loadSettings()).appearance.theme
  })
  handleIPC('save-settings', async (_e, data) => {
    // Load the settings from the store
    const settings = await saveSettings(data)
    NotificationService.getInstance().setSettings(settings.general, settings.profiles)
    AzureDevOpsService.getInstance().setConfiguration(settings.azDo)
    AzureDevOpsService.getInstance().updateDataImmediately()

    mainWindow.webContents.send('theme-changed', settings.appearance.theme)
    mainWindow.webContents.send('settings', settings)
  })

  handleIPC('validate-azure-devops', async (_e, arg: { organizationUrl: string; project: string; pat: string }) => {
    try {
      const authHandler = azdev.getPersonalAccessTokenHandler(arg.pat)
      const connection = new azdev.WebApi(arg.organizationUrl, authHandler)
      const connectionData = await connection.connect()

      return {
        userDisplayName: connectionData.authenticatedUser?.providerDisplayName,
        error: null,
      }
    } catch (error) {
      let message = 'Unknown Error'
      if (error instanceof Error && error.message) message = error.message

      return { userDisplayName: null, error: message }
    }
  })

  handleIPC('get-pr-data', async (_e) => {
    return AzureDevOpsService.getInstance().getPullRequests()
  })

  handleIPC('update-pr-data', async (_e) => {
    return AzureDevOpsService.getInstance().updateDataImmediately()
  })

  handleIPC('approve-prs', async (_e, data: PullRequest[]) => {
    await AzureDevOpsService.getInstance().approvePullRequests(data)
  })

  handleIPC('reset-pr-feedback', async (_e, pr: PullRequest) => {
    await AzureDevOpsService.getInstance().resetPullRequestFeedback(pr)
  })

  handleIPC('check-vscode-installed', async () => {
    const command = process.platform === 'win32' ? 'code.cmd --version' : 'code --version'
    try {
      await execAsync(command, { timeout: 2000, windowsHide: true })
      return true
    } catch {
      return false
    }
  })

  const resolveRepositoryPath = async (repositoryName: string): Promise<string | null> => {
    const settings = await loadSettings()
    const rootDirectory = settings.general.repositoriesRootDirectory
    if (!rootDirectory) {
      return null
    }

    // Avoid path traversal / absolute path escapes (repositoryName comes from the renderer / PR metadata).
    if (
      repositoryName.includes('..') ||
      repositoryName.includes('/') ||
      repositoryName.includes('\\') ||
      path.isAbsolute(repositoryName) ||
      /^[a-zA-Z]:/.test(repositoryName)
    ) {
      return null
    }

    const rootResolved = path.resolve(rootDirectory)
    const fallbackPath = path.resolve(rootResolved, repositoryName)
    if (path.relative(rootResolved, fallbackPath).startsWith('..')) {
      return null
    }

    try {
      const stat = await fs.stat(fallbackPath)
      if (stat.isDirectory()) {
        return fallbackPath
      }
    } catch {
      // Ignore and attempt case-insensitive directory mapping.
    }

    try {
      const entries = await fs.readdir(rootResolved, { withFileTypes: true })
      const matchingEntry = entries.find(
        (entry) => entry.isDirectory() && entry.name.localeCompare(repositoryName, undefined, { sensitivity: 'base' }) === 0
      )

      return matchingEntry ? path.resolve(rootResolved, matchingEntry.name) : null
    } catch {
      return null
    }
  }

  handleIPC('open-in-vscode', async (_e, repositoryName: string) => {
    const repositoryPath = await resolveRepositoryPath(repositoryName)
    if (!repositoryPath) {
      return false
    }

    const vscodeUri = pathToFileURL(repositoryPath).href.replace(/^file:\/\//, 'vscode://file')
    await shell.openExternal(vscodeUri)
    return true
  })

  handleIPC('find-solution-files', async (_e, repositoryName: string) => {
    const repositoryPath = await resolveRepositoryPath(repositoryName)
    if (!repositoryPath) {
      return []
    }

    try {
      const entries = await fs.readdir(repositoryPath, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.slnx')))
        .map((entry) => path.resolve(repositoryPath, entry.name))
    } catch {
      return []
    }
  })

  handleIPC('open-solution-file', async (_e, solutionPath: string) => {
    await shell.openPath(solutionPath)
  })

  handleIPC('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  handleIPC('update:install-update', async (_e) => {
    const updater = PullRequestUpdateManager.getInstance()
    await updater.downloadUpdate()
  })
}
