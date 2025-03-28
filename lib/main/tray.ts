import { Menu, nativeImage, Tray } from 'electron'
import { getAssetPath } from './util'
import loader from '../tools/loading.service'
import { TrayManager } from './trayManager'

let trayIcon: Tray | null = null
let trayManager: TrayManager | null = null

export default function createTrayIcon(showWindow: () => void, exitApp: () => void): void {
  if (trayIcon) {
    return
  }

  loader.loadingEvent.on('loading', ({ isLoading }) => {
    if (trayIcon) {
      if (isLoading) {
        trayManager?.startAnimation()
      } else {
        trayManager?.stopAnimation()
      }
    }
  })

  trayIcon = new Tray(getAssetPath('tray/pull.png'))
  trayManager = new TrayManager(
    trayIcon,
    getAssetPath('tray/pull-colored@3x.png'),
    getAssetPath('tray/pull@3x.png'),
    [0, 4, 8, 12, 16, 20, 24, 28, 32].map((i) => getAssetPath(`tray/loader/frame_${i.toString().padStart(2, '0')}@3x.png`))
  )

  trayIcon.addListener('click', () => showWindow())
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show window',
      type: 'normal',
      icon: nativeImage.createFromPath(getAssetPath('tray/table-layout.png')).resize({ width: 16, height: 16 }),
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit PullReqestManager',
      type: 'normal',
      icon: nativeImage.createFromPath(getAssetPath('tray/shut-down.png')).resize({ width: 16, height: 16 }),
      click: () => exitApp(),
    },
  ])
  trayIcon.setToolTip('PullRequest-Manager')
  trayIcon.setContextMenu(contextMenu)
}
