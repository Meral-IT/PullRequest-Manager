import { Menu, nativeImage, Tray } from 'electron'
import loader from '../tools/loading.service'
import { TrayManager } from './trayManager'
import pull from '@/resources/tray/pull@3x.png?asset'
import pullColored from '@/resources/tray/pull-colored@3x.png?asset'
import tableLayout from '@/resources/tray/table-layout.png?asset'
import shutDown from '@/resources/tray/shut-down.png?asset'
import loaderFrame1 from '@/resources/tray/loader/frame_00@3x.png?asset'
import loaderFrame4 from '@/resources/tray/loader/frame_04@3x.png?asset'
import loaderFrame8 from '@/resources/tray/loader/frame_08@3x.png?asset'
import loaderFrame12 from '@/resources/tray/loader/frame_12@3x.png?asset'
import loaderFrame16 from '@/resources/tray/loader/frame_16@3x.png?asset'
import loaderFrame20 from '@/resources/tray/loader/frame_20@3x.png?asset'
import loaderFrame24 from '@/resources/tray/loader/frame_24@3x.png?asset'
import loaderFrame28 from '@/resources/tray/loader/frame_28@3x.png?asset'
import loaderFrame32 from '@/resources/tray/loader/frame_32@3x.png?asset'

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

  trayIcon.addListener('click', () => showWindow())
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show window',
      type: 'normal',
      icon: nativeImage.createFromPath(tableLayout).resize({ width: 16, height: 16 }),
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit PullReqestManager',
      type: 'normal',
      icon: nativeImage.createFromPath(shutDown).resize({ width: 16, height: 16 }),
      click: () => exitApp(),
    },
  ])
  trayIcon.setToolTip('PullRequest-Manager')
  trayIcon.setContextMenu(contextMenu)
}
