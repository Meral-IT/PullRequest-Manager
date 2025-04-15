import { NativeImage, Tray } from 'electron'

export class TrayManager {
  tray: Tray
  trayAnimationFrames: NativeImage[] | string[]
  animationInterval: NodeJS.Timeout | undefined
  activeImage: NativeImage | string
  idleImage: NativeImage | string
  active: boolean = false

  constructor(
    tray: Tray,
    activeImage: NativeImage | string,
    idleImage: NativeImage | string,
    trayAnimationFrames: NativeImage[] | string[]
  ) {
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
