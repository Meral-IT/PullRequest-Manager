import * as azdev from 'azure-devops-node-api'
import { app, type BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import os from 'os'
import {
  approvePullRequests,
  getPullRequests,
  setConfiguration,
  updateDataImmediately,
} from '../azure-devops/azure-devops.service'
import { loadSettings, saveSettings } from '../main/settings'
import { PullRequest } from '../models/pull-request.model'

export const registerNativeThemeEventListeners = (allBrowserWindows: BrowserWindow[]) => {
  nativeTheme.addListener('updated', () => {
    allBrowserWindows.forEach((browserWindow) => {
      browserWindow.webContents.send('nativeThemeChanged')
    })
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
    setConfiguration(settings.azDo)
    updateDataImmediately()

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
    return getPullRequests()
  })

  handleIPC('approve-prs', async (_e, data: PullRequest[]) => {
    await approvePullRequests(data)
  })
}
