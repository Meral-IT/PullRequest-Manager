import { Tray } from 'electron'

export class TrayManager {
  tray: Tray
  trayAnimationFrames: string[]
  animationInterval: NodeJS.Timeout | undefined
  activeImage: string
  idleImage: string
  active: boolean = false

  constructor(tray: Tray, activeImage: string, idleImage: string, trayAnimationFrames: string[]) {
    this.tray = tray
    this.trayAnimationFrames = trayAnimationFrames
    this.activeImage = activeImage
    this.idleImage = idleImage

    this.animationInterval = undefined
    this.tray.setImage(this.idleImage)
  }

  setActive() {
    this.active = true
    this.tray.setImage(this.trayAnimationFrames[0])
  }

  startAnimation() {
    if (this.animationInterval === undefined) {
      let i = 0
      this.animationInterval = setInterval(() => {
        this.tray.setImage(this.trayAnimationFrames[i])
        i = i === this.trayAnimationFrames.length - 1 ? 0 : i + 1
      }, 500)
    }
  }

  stopAnimation() {
    clearInterval(this.animationInterval)
    this.animationInterval = undefined
    this.tray.setImage(this.active ? this.activeImage : this.idleImage)
  }
}
