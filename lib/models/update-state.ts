import type { ProgressInfo, UpdateInfo } from 'electron-updater'

export type UpdateState =
  | { status: 'idle' }
  | { status: 'available' | 'ready' | 'installing'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; progress?: ProgressInfo }
  | { status: 'error'; info: UpdateInfo; operation: 'download' | 'install' }
