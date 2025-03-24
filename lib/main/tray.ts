import { Menu, nativeImage, Tray } from 'electron'
import { getAssetPath } from './util'

let trayIcon: Tray | null = null

export default function createTrayIcon(showWindow: () => void, exitApp: () => void): void {
  if (trayIcon) {
    return
  }

  trayIcon = new Tray(getAssetPath('pull-colored.png'))
  trayIcon.addListener('click', () => showWindow())
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show window',
      type: 'normal',
      icon: nativeImage.createFromPath(getAssetPath('table-layout.png')).resize({ width: 16, height: 16 }),
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit PullReqestManager',
      type: 'normal',
      icon: nativeImage.createFromPath(getAssetPath('shut-down.png')).resize({ width: 16, height: 16 }),
      click: () => exitApp(),
    },
  ])
  trayIcon.setToolTip('PullRequestManager')
  trayIcon.setContextMenu(contextMenu)
}
