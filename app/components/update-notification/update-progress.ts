import type { ProgressInfo } from 'electron-updater'

const validBytes = (value?: number) => (value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0)
const formatBytes = (bytes: number): string => {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log10(Math.max(1, bytes)) / 3), units.length - 1)
  return `${(bytes / 1000 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`
}

export function getDownloadProgress(info?: ProgressInfo) {
  const total = validBytes(info?.total)
  const transferred = Math.min(validBytes(info?.transferred), total || Infinity)
  const speed = validBytes(info?.bytesPerSecond)
  const percent =
    total > 0 && info && Number.isFinite(info.percent) ? Math.min(100, Math.max(0, info.percent)) : undefined
  const finishing = percent === 100
  const seconds = total > transferred && speed > 0 ? Math.ceil((total - transferred) / speed) : 0
  const remaining =
    !finishing && Number.isFinite(seconds) && seconds > 0
      ? seconds < 60
        ? `About ${seconds} sec left`
        : `About ${Math.ceil(seconds / 60)} min left`
      : undefined
  return {
    percent,
    finishing,
    size: total
      ? `${formatBytes(transferred)} of ${formatBytes(total)}`
      : transferred
        ? `${formatBytes(transferred)} downloaded`
        : undefined,
    speed: speed > 0 && !finishing ? `${formatBytes(speed)}/s` : undefined,
    remaining,
  }
}
