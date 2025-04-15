import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'
import { installExtension, REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'
import log from 'electron-log/main'
import { registerNativeThemeEventListeners } from '../window/ipcEvents'
import getOrCreateAppWindow, { createAppWindow } from './app'

// initialize the logger for any renderer process
log.initialize()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('meralit.pullrequest-manager')

  installExtension([REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS])
    .then((ext) => log.debug(`Added Extension: ${ext.map((e) => e.name).join(', ')}`))
    .catch((err) => log.debug('An error occurred: ', err))

  // Create app window
  getOrCreateAppWindow()

  registerNativeThemeEventListeners(BrowserWindow.getAllWindows())

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file, you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
