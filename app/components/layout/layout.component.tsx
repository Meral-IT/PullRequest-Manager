import {
  Button,
  FluentProvider,
  ProgressBar,
  Text,
  Toast,
  ToastBody,
  Toaster,
  ToastFooter,
  ToastTitle,
  useId,
  useToastController,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components'
import { ProgressInfo, UpdateInfo } from 'electron-updater'
import { ReactNode, useEffect, useState } from 'react'
import { JSX } from 'react/jsx-runtime'

const shouldUseDarkColors = (): boolean =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

const getTheme = (name: string) => {
  switch (name) {
    case 'system':
      return shouldUseDarkColors() ? webDarkTheme : webLightTheme
    case 'light':
      return webLightTheme
    case 'dark':
      return webDarkTheme
    default:
      return webDarkTheme
  }
}

interface Props {
  children: ReactNode
}

function Layout({ children }: Readonly<Props>) {
  const updateAvailableToastId = useId('toast1')
  const downloadProgressToastId = useId('toast2')
  const toasterId = useId('toaster')
  const [theme, setTheme] = useState<string>('system')
  const { dispatchToast, dismissToast, updateToast } = useToastController(toasterId)

  const updateNotify = (info: UpdateInfo) =>
    dispatchToast(
      <Toast>
        <ToastTitle>Update available!</ToastTitle>
        <ToastBody>Version {info.version} is available for update.</ToastBody>
        <ToastFooter>
          <Button onClick={installUpdate}>Update</Button>
        </ToastFooter>
      </Toast>,
      { toastId: updateAvailableToastId, intent: 'info', timeout: -1 }
    )

  const createDownloadingUpdateToast = (info: ProgressInfo) =>
    dispatchToast(
      <Toast>
        <ToastTitle>Downloading update</ToastTitle>
        <ToastBody>
          <Text>Downloading update ({info.bytesPerSecond}bytes/second)...</Text>
          <ProgressBar value={info.percent} max={100} />
        </ToastBody>
      </Toast>,
      { toastId: downloadProgressToastId, intent: 'info', timeout: -1 }
    )

  const updateDownloadingUpdateToast = (info: ProgressInfo) =>
    updateToast({
      content: (
        <Toast>
          <ToastTitle>Downloading update</ToastTitle>
          <ToastBody>
            <Text>Downloading update ({info.bytesPerSecond}bytes/second)...</Text>
            <ProgressBar value={info.percent} max={100} />
          </ToastBody>
        </Toast>
      ),
      intent: 'info',
      toastId: downloadProgressToastId,
      timeout: -1,
    })

  const installUpdate = () => {
    dismissToast(updateAvailableToastId)
    createDownloadingUpdateToast({ bytesPerSecond: 0, percent: 0, total: 0, delta: 0, transferred: 0 })
    window.api.invoke('update:install-update')
  }

  useEffect(() => {
    return window.api.receive('nativeThemeChanged', () => {
      if (theme === 'system') {
        setTheme(shouldUseDarkColors() ? 'dark' : 'light')
      }
    })
  }, [])

  useEffect(() => {
    return window.api.receive('update:update-available', (info: UpdateInfo) => {
      updateNotify(info)
    })
  }, [])

  useEffect(() => {
    return window.api.receive('update:download-progress', (info: ProgressInfo) => {
      updateDownloadingUpdateToast(info)
    })
  }, [])

  useEffect(() => {
    window.api.invoke('get-theme').then((theme) => {
      setTheme(theme)
    })

    window.api.receive('theme-changed', (theme: string) => {
      setTheme(theme)
    })
  }, [])

  const fluentTheme = getTheme(theme)

  return (
    <FluentProvider theme={fluentTheme} style={{ height: '100vh' }}>
      <Toaster toasterId={toasterId} />
      {children}
    </FluentProvider>
  )
}

export default Layout
function updateToast(arg0: { content: JSX.Element; intent: string; toastId: any; timeout: number }) {
  throw new Error('Function not implemented.')
}
