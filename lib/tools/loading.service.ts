import { BrowserWindow } from 'electron/main'
import EventEmitter from 'events'

export interface ILoadingService {
  loadingEvent: EventEmitter
  isLoading: boolean
  start(): void
  stop(): void
}

class LoadingService implements ILoadingService {
  index: number = 0
  public loadingEvent: EventEmitter = new EventEmitter()
  public isLoading: boolean = false

  public start() {
    if (++this.index > 0) {
      this.setLoading(true)
    }
  }

  public stop() {
    if (this.index > 0) {
      this.index--
    }
    if (this.index === 0) {
      this.setLoading(false)
    }
  }

  private setLoading(value: boolean) {
    if (this.isLoading === value) {
      return
    }

    this.isLoading = value

    this.loadingEvent.emit('loading', {
      isLoading: this.isLoading,
    })
    this.sendIpc('loading', {
      isLoading: this.isLoading,
    })
  }

  private sendIpc(channel, message) {
    BrowserWindow?.getAllWindows()?.forEach((wnd) => {
      if (wnd.webContents?.isDestroyed() === false && wnd.webContents?.isCrashed() === false) {
        wnd.webContents.send(channel, message)
      }
    })
  }
}

const loader = new LoadingService()

export default loader as ILoadingService
