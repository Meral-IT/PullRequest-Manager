import { type BrowserWindow, dialog } from 'electron'

export function registerSettingsUnloadProtection(window: BrowserWindow): void {
  window.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'Unsaved changes',
      message: 'You have unsaved changes. Are you sure you want to leave?',
      detail: 'Any unsaved changes will be lost.',
      buttons: ['Stay', 'Leave'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    // Electron allows the unload when this event is prevented.
    if (response === 1) event.preventDefault()
  })
}
