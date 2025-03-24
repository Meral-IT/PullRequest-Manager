import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components'
import { ReactNode, useEffect, useState } from 'react'

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

function Layout({ children }: Props) {
  const [theme, setTheme] = useState<string>('system')

  useEffect(() => {
    window.api.receive('nativeThemeChanged', () => {
      if (theme === 'system') {
        setTheme(shouldUseDarkColors() ? 'dark' : 'light')
      }
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
      {children}
    </FluentProvider>
  )
}

export default Layout
