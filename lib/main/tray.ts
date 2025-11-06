import loaderFrame1 from '@/resources/tray/loader/frame_00@3x.png?asset'
import loaderFrame4 from '@/resources/tray/loader/frame_04@3x.png?asset'
import loaderFrame8 from '@/resources/tray/loader/frame_08@3x.png?asset'
import loaderFrame12 from '@/resources/tray/loader/frame_12@3x.png?asset'
import loaderFrame16 from '@/resources/tray/loader/frame_16@3x.png?asset'
import loaderFrame20 from '@/resources/tray/loader/frame_20@3x.png?asset'
import loaderFrame24 from '@/resources/tray/loader/frame_24@3x.png?asset'
import loaderFrame28 from '@/resources/tray/loader/frame_28@3x.png?asset'
import loaderFrame32 from '@/resources/tray/loader/frame_32@3x.png?asset'
import pullColored from '@/resources/tray/pull-colored@3x.png?asset'
import pull from '@/resources/tray/pull@3x.png?asset'
import refresh from '@/resources/tray/refresh.png?asset'
import shutDown from '@/resources/tray/shut-down.png?asset'
import tableLayout from '@/resources/tray/table-layout.png?asset'
import { app, BrowserWindow, Menu, MenuItem, nativeImage, Tray } from 'electron'
import { AzureDevOpsService } from '../azure-devops/azure-devops.service'
import { PrProfile } from '../models/pr-profile'
import loader from '../tools/loading.service'
import getOrCreateAppWindow, { showWindow } from './app'
import { loadSettings } from './settings'
import { TrayManager } from './trayManager'

let trayIcon: Tray | null = null
let trayManager: TrayManager | null = null

function createTrayMenu(mainWindow: BrowserWindow, profiles?: PrProfile[]): Menu {
  const contextMenu = Menu.buildFromTemplate([
    {
      id: 'toggle-window',
      label: 'Toggle window',
      type: 'normal',
      icon: nativeImage.createFromPath(tableLayout).resize({ width: 16, height: 16 }),
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          showWindow()
        }
      },
    },
    {
      id: 'update-data',
      label: 'Update data',
      type: 'normal',
      icon: nativeImage.createFromPath(refresh).resize({ width: 16, height: 16 }),
      click: () => AzureDevOpsService.getInstance().updateDataImmediately(),
    },
    { type: 'separator' },
    {
      id: 'approve',
      label: 'Approve...',
      type: 'submenu',
      visible: false,
      submenu: [],
    },
    { type: 'separator' },
    {
      id: 'settings',
      label: 'Quit PullReqestManager',
      type: 'normal',
      icon: nativeImage.createFromPath(shutDown).resize({ width: 16, height: 16 }),
      click: () => app.exit(),
    },
  ])

  if (profiles) {
    const approveMenu = contextMenu?.getMenuItemById('approve')
    if (approveMenu) {
      const enabledProfiles = profiles.filter((x) => x.enableAcceptAll)
      enabledProfiles.forEach((profile) => {
        approveMenu.submenu?.append(
          new MenuItem({
            label: profile.label,
            type: 'normal',
            click: () => {
              AzureDevOpsService.getInstance().approvePullRequestsForProfile(profile)
            },
          })
        )
      })
      approveMenu.visible = enabledProfiles.length > 0
    }
  }

  return contextMenu
}

export function updateTrayProfiles(profiles: PrProfile[]): void {
  if (!trayIcon) {
    return
  }

  const contextMenu = createTrayMenu(getOrCreateAppWindow(), profiles)
  trayIcon.setContextMenu(contextMenu)
}

export function getTrayManager(): TrayManager | null {
  return trayManager
}

export default async function createTrayIcon(mainWindow: BrowserWindow) {
  if (trayIcon) {
    return
  }

  trayIcon = new Tray(pull)
  trayManager = new TrayManager(trayIcon, pullColored, pull, [
    loaderFrame1,
    loaderFrame4,
    loaderFrame8,
    loaderFrame12,
    loaderFrame16,
    loaderFrame20,
    loaderFrame24,
    loaderFrame28,
    loaderFrame32,
  ])

  trayIcon.addListener('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showWindow()
    }
  })
  const settings = await loadSettings()
  const contextMenu = createTrayMenu(mainWindow, settings.profiles)

  loader.loadingEvent.on('loading', ({ isLoading }) => {
    if (trayIcon) {
      contextMenu.getMenuItemById('update-data')!.enabled = !isLoading
      if (isLoading) {
        trayManager?.startAnimation()
      } else {
        trayManager?.stopAnimation()
      }
    }
  })

  trayIcon.setToolTip('PullRequest-Manager')
  trayIcon.setContextMenu(contextMenu)
}
