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
import { app, BrowserWindow, Menu, MenuItem, nativeImage, NativeImage, nativeTheme, Tray } from 'electron'
import log from 'electron-log/main'
import { AzureDevOpsIntegrationsService } from '../azure-devops/azure-devops-integrations.service'
import { PrProfile } from '../models/pr-profile'
import { getAzureDevOpsAccessFailure } from '../models/azure-devops-access'
import loader from '../tools/loading.service'
import getOrCreateAppWindow, { showWindow } from './app'
import { loadSettings } from './settings'
import { TrayManager } from './trayManager'

let trayIcon: Tray | null = null
let trayManager: TrayManager | null = null
let contextMenu: Menu | null = null
let trayProfiles: PrProfile[] = []

function themedImage(image: NativeImage, darkBackground: boolean): NativeImage {
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
    return image
  }
  if (darkBackground || image.isEmpty()) {
    return image
  }

  const result = nativeImage.createEmpty()
  for (const scaleFactor of image.getScaleFactors()) {
    const bitmap = image.toBitmap({ scaleFactor })
    for (let i = 0; i < bitmap.length; i += 4) {
      bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = 0
    }
    // PNG dimensions preserve physical pixels when getSize() rounds a scaled image.
    const png = image.toPNG({ scaleFactor })
    result.addRepresentation({
      scaleFactor,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      buffer: bitmap,
    })
  }
  return result
}

function createMenuImage(imagePath: string): NativeImage {
  return themedImage(
    nativeImage.createFromPath(imagePath).resize({ width: 16, height: 16 }),
    nativeTheme.shouldUseDarkColors
  )
}

function createTrayMenu(mainWindow: BrowserWindow, profiles?: PrProfile[]): Menu {
  const contextMenu = Menu.buildFromTemplate([
    {
      id: 'toggle-window',
      label: 'Toggle window',
      type: 'normal',
      icon: createMenuImage(tableLayout),
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
      icon: createMenuImage(refresh),
      enabled: !loader.isLoading,
      click: () =>
        AzureDevOpsIntegrationsService.getInstance()
          .updateDataImmediately()
          .catch((error) => {
            log.error('Failed to refresh pull requests', getAzureDevOpsAccessFailure(error).message)
          }),
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
      icon: createMenuImage(shutDown),
      click: () => app.exit(),
    },
  ])

  if (profiles) {
    const approveMenu = contextMenu?.getMenuItemById('approve')
    if (approveMenu) {
      const enabledProfiles = profiles.filter((profile) => profile.enableAcceptAll)
      for (const profile of enabledProfiles) {
        approveMenu.submenu?.append(
          new MenuItem({
            label: profile.label,
            type: 'normal',
            click: () => {
              AzureDevOpsIntegrationsService.getInstance()
                .approvePullRequestsForProfile(profile)
                .catch((error) => {
                  log.error('Failed to approve pull requests', getAzureDevOpsAccessFailure(error).message)
                })
            },
          })
        )
      }

      approveMenu.visible = enabledProfiles.length > 0
    }
  }

  return contextMenu
}

export function updateTrayProfiles(profiles: PrProfile[]): void {
  trayProfiles = profiles
  if (!trayIcon) {
    return
  }

  contextMenu = createTrayMenu(getOrCreateAppWindow(), profiles)
  trayIcon.setContextMenu(contextMenu)
}

export function getTrayManager(): TrayManager | null {
  return trayManager
}

export default async function createTrayIcon(mainWindow: BrowserWindow) {
  if (trayIcon) {
    return
  }

  const createTrayImage = (imagePath: string): NativeImage =>
    themedImage(
      nativeImage.createFromPath(imagePath),
      process.platform === 'win32'
        ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
        : nativeTheme.shouldUseDarkColors
    )
  const idleImage = createTrayImage(pull)
  const animationFrames = [
    loaderFrame1,
    loaderFrame4,
    loaderFrame8,
    loaderFrame12,
    loaderFrame16,
    loaderFrame20,
    loaderFrame24,
    loaderFrame28,
    loaderFrame32,
  ]
  trayIcon = new Tray(idleImage)
  trayManager = new TrayManager(trayIcon, pullColored, idleImage, animationFrames.map(createTrayImage))

  trayIcon.addListener('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showWindow()
    }
  })
  const settings = await loadSettings()
  updateTrayProfiles(settings.profiles)

  nativeTheme.on('updated', () => {
    trayManager!.idleImage = createTrayImage(pull)
    trayManager!.trayAnimationFrames = animationFrames.map(createTrayImage)
    trayManager!.setActiveState(trayManager!.active)
    updateTrayProfiles(trayProfiles)
  })

  loader.loadingEvent.on('loading', ({ isLoading }) => {
    if (trayIcon) {
      contextMenu!.getMenuItemById('update-data')!.enabled = !isLoading
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
