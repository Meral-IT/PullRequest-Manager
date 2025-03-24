import { BrowserWindow, shell, app, screen } from 'electron'
import { join } from 'path'
import { registerWindowIPC } from '@/lib/window/ipcEvents'
import appIcon from '@/resources/azure-devops.png'
import { loadSettings } from './settings'
import { setConfiguration, start } from '../azure-devops/azure-devops.service'
import createTrayIcon from './tray'

let mainWindow: BrowserWindow | null = null

async function initializeAzureDevOps(): Promise<void> {
  const settings = await loadSettings()
  setConfiguration(settings.azDo)
  start()
}

export function exitApp(): void {
  app.exit()
}
export function showWindow(): void {
  if (!mainWindow) {
    throw new Error('"mainWindow" is not defined')
  }
  const display = screen.getPrimaryDisplay()
  const size = mainWindow.getSize()
  const width = size[0]
  const height = size[1]

  mainWindow.setPosition(display.workAreaSize.width - width, display.workAreaSize.height - height)
  mainWindow.show()
}

export function createAppWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    icon: appIcon,
    frame: false,
    titleBarStyle: 'hiddenInset',
    title: 'PullRequest-Manager',
    maximizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
    },
  })

  // Register IPC events for the main window.
  registerWindowIPC(mainWindow)

  mainWindow.on('ready-to-show', async () => {
    await initializeAzureDevOps()
    createTrayIcon(showWindow, exitApp)
    mainWindow.show()
  })

  // Hide the window instead of closing it, so it can be reopened quickly
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}
export default function getOrCreateAppWindow(): BrowserWindow {
  if (!mainWindow) {
    mainWindow = createAppWindow()
  }
  return mainWindow
}
