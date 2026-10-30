import { app, type BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import log from 'electron-log/main'
import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { AzureDevOpsIntegrationsService } from '../azure-devops/azure-devops-integrations.service'
import { NotificationService } from '../main/notification.service'
import { acknowledgeAzureDevOpsRequirements, loadSettings, saveSettings } from '../main/settings'
import { PullRequestUpdateManager } from '../main/update'
import { PullRequest } from '../models/pull-request.model'
import {
  AzureDevOpsConnection,
  createAzureDevOpsAccess,
  getAzureDevOpsAccessFailure,
} from '../models/azure-devops-access'

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

  handleIPC('get-settings', () => {
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
    AzureDevOpsIntegrationsService.getInstance().setConfiguration(settings.azDoIntegrations)
    AzureDevOpsIntegrationsService.getInstance()
      .updateDataImmediately()
      .catch((error) => {
        log.error('Failed to refresh after saving settings', getAzureDevOpsAccessFailure(error).message)
      })

    mainWindow.webContents.send('theme-changed', settings.appearance.theme)
    mainWindow.webContents.send('settings', settings)
  })

  handleIPC('validate-azure-devops', async (_e, arg: AzureDevOpsConnection & { integrationId: string }) => {
    try {
      return await AzureDevOpsIntegrationsService.getInstance().validateConnection(arg, arg.integrationId)
    } catch (error) {
      const failure = getAzureDevOpsAccessFailure(error)
      const access = createAzureDevOpsAccess()
      access.features = { code: failure, identity: failure, vote: failure }
      return { userDisplayName: null, error: failure.message, access }
    }
  })

  handleIPC(
    'acknowledge-azure-devops-requirements',
    async (_e, arg: { requirementsFingerprint: string; connectionRevision: number; integrationId: string }) => {
      const service = AzureDevOpsIntegrationsService.getInstance()
      if (!service.canAcknowledgeAccess(arg.requirementsFingerprint, arg.connectionRevision, arg.integrationId))
        return false
      const settings = await loadSettings()
      const integration = settings.azDoIntegrations.find((item) => item.id === arg.integrationId)
      if (!integration) return false
      const saved = await acknowledgeAzureDevOpsRequirements(
        arg.requirementsFingerprint,
        integration,
        arg.integrationId
      )
      if (!saved) return false
      if (!service.canAcknowledgeAccess(arg.requirementsFingerprint, arg.connectionRevision, arg.integrationId))
        return false
      service.acknowledgeAccess(arg.integrationId)
      return true
    }
  )

  handleIPC('get-pr-data', (_e) => {
    return AzureDevOpsIntegrationsService.getInstance().getPullRequests()
  })

  handleIPC('update-pr-data', (_e) => {
    return AzureDevOpsIntegrationsService.getInstance().updateDataImmediately()
  })

  handleIPC('approve-prs', async (_e, data: PullRequest[]) => {
    await AzureDevOpsIntegrationsService.getInstance().approvePullRequests(data)
  })

  handleIPC('reset-pr-feedback', async (_e, pr: PullRequest) => {
    await AzureDevOpsIntegrationsService.getInstance().resetPullRequestFeedback(pr)
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
        (entry) =>
          entry.isDirectory() && entry.name.localeCompare(repositoryName, undefined, { sensitivity: 'base' }) === 0
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

    const fileUrl = pathToFileURL(repositoryPath)
    const pathname = fileUrl.host ? `//${fileUrl.host}${fileUrl.pathname}` : fileUrl.pathname
    const vscodeUri = new URL(`vscode://file${pathname}`)
    await shell.openExternal(vscodeUri.toString())
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
    const settings = await loadSettings()
    const rootDirectory = settings.general.repositoriesRootDirectory
    if (!rootDirectory) {
      return false
    }

    const resolvedRoot = path.resolve(rootDirectory)
    const resolvedSolutionPath = path.resolve(solutionPath)

    if (
      (!resolvedSolutionPath.endsWith('.sln') && !resolvedSolutionPath.endsWith('.slnx')) ||
      path.relative(resolvedRoot, resolvedSolutionPath).startsWith('..')
    ) {
      return false
    }

    await shell.openPath(resolvedSolutionPath)
    return true
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

  handleIPC('update:get-state', () => PullRequestUpdateManager.getInstance().getState())
  handleIPC('update:download-update', () => PullRequestUpdateManager.getInstance().downloadUpdate())
  handleIPC('update:install-update', () => PullRequestUpdateManager.getInstance().installUpdate())
}
