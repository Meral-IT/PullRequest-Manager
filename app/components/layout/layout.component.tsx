import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components'
import { ReactNode, useEffect, useState } from 'react'
import UpdateNotification from '../update-notification/update-notification.component'

const shouldUseDarkColors = (): boolean => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

const getTheme = (name: string, systemDark: boolean) => {
  switch (name) {
    case 'system':
      return systemDark ? webDarkTheme : webLightTheme
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
  const [theme, setTheme] = useState<string>('system')

  const [systemDark, setSystemDark] = useState(shouldUseDarkColors)

  useEffect(() => {
    let active = true
    let themeReceived = false
    const unsubscribeNative = globalThis.api.receive('nativeThemeChanged', () => {
      setSystemDark(shouldUseDarkColors())
    })
    const unsubscribeTheme = globalThis.api.receive('theme-changed', (theme: string) => {
      themeReceived = true
      setTheme(theme)
    })
    globalThis.api
      .invoke('get-theme')
      .then((theme) => {
        if (active && !themeReceived) setTheme(theme)
      })
      .catch((error) => console.error('Unable to load theme', error))

    return () => {
      active = false
      unsubscribeNative()
      unsubscribeTheme()
    }
  }, [])

  const fluentTheme = getTheme(theme, systemDark)

  return (
    <FluentProvider theme={fluentTheme} style={{ height: '100vh' }}>
      <UpdateNotification />
      {children}
    </FluentProvider>
  )
}

export default Layout
