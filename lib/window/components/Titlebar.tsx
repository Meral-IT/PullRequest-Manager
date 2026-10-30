import {
  Button,
  makeStyles,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Slot,
  Spinner,
  tokens,
  Tooltip,
} from '@fluentui/react-components'
import { DismissFilled, LineHorizontal1Filled, MaximizeFilled } from '@fluentui/react-icons'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TitlebarMenu, TitlebarMenuItem } from '../titlebarMenus'
import { useWindowContext } from './WindowContext'

const useStyles = makeStyles({
  titlebar: {
    backgroundColor: tokens.colorNeutralBackground3,
  },
})

export const Titlebar = () => {
  const styles = useStyles()
  const { title, icon } = useWindowContext().titlebar
  const [loaderVisible, setLoaderVisible] = useState(false)
  const wcontext = useWindowContext().window

  useEffect(() => {
    return globalThis.api.receive('loading', (event) => {
      setLoaderVisible(event.isLoading)
    })
  }, [])

  const titleSpinner = loaderVisible ? (
    <Tooltip content={'Loading...'} relationship="label" withArrow>
      <Spinner size="tiny" />
    </Tooltip>
  ) : null

  return (
    <div className={['window-titlebar', styles.titlebar].join(' ')} data-platform={wcontext?.platform ?? 'darwin'}>
      {wcontext?.platform === 'win32' && (
        <div className="window-titlebar-icon">
          <img src={icon} alt="PullRequest-Manager Logo" />
        </div>
      )}

      <div className="window-titlebar-title">
        <span className="window-titlebar-title-text" title={title}>
          {title}
        </span>
        {titleSpinner}
      </div>
      <TitlebarMenu />
      {wcontext?.platform === 'win32' && <TitlebarControls />}
    </div>
  )
}

function TitlebarMenu() {
  const { menuItems } = useWindowContext().titlebar

  if (!menuItems?.length) return null

  return (
    <nav className="window-titlebar-menu" aria-label="Application menu">
      {menuItems.map((menu) => (
        <TitlebarMenuItem key={menu.name} menu={menu} />
      ))}
    </nav>
  )
}

function TitlebarMenuItem({ menu }: Readonly<{ menu: TitlebarMenu }>) {
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <MenuButton size="small" appearance="subtle">
          {menu.name}
        </MenuButton>
      </MenuTrigger>

      <MenuPopover>
        <MenuList>
          {menu.items.map((item) => (
            <TitlebarMenuPopupItem key={item.name} item={item} />
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}

const TitlebarMenuPopupItem = ({ item }: { item: TitlebarMenuItem }) => {
  const nav = useNavigate()

  function handleAction() {
    // Check if the item has a valid action callback
    if (typeof item.actionCallback === 'function') {
      item.actionCallback()
      return
    } else if (item.action === 'navigate' && item.actionParams) {
      // Navigate to the provided route
      const route = item.actionParams[0] as string
      nav(route)
      return
    }

    // Invoke the action with the provided parameters
    globalThis.api.invoke(item.action!, ...(item.actionParams ?? [])).catch(console.error)
  }

  if (item.name === '---') {
    return <MenuDivider />
  }

  if (item.items && item.items.length > 0) {
    return (
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <MenuItem>{item.name}</MenuItem>
        </MenuTrigger>

        <MenuPopover>
          <MenuList>
            {item.items.map((subItem) => (
              <TitlebarMenuPopupItem key={subItem.name} item={subItem} />
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    )
  }

  return (
    <MenuItem
      className="menuItem-popupItem"
      subText={item.subText}
      secondaryContent={item.shortcut}
      onClick={handleAction}
    >
      {item.name}
    </MenuItem>
  )
}

const TitlebarControls = () => {
  const wcontext = useWindowContext().window

  return (
    <div className="window-titlebar-controls">
      {wcontext?.minimizable && <TitlebarControlButton label="minimize" icon={<LineHorizontal1Filled />} />}
      {wcontext?.maximizable && <TitlebarControlButton label="maximize" icon={<MaximizeFilled />} />}
      <TitlebarControlButton label="close" icon={<DismissFilled color={tokens.colorStatusDangerForeground1} />} />
    </div>
  )
}

const TitlebarControlButton = ({ icon, label }: { icon: Slot<'span'>; label: string }) => {
  const handleAction = () => {
    switch (label) {
      case 'minimize':
        globalThis.api.invoke('window-minimize').catch(console.error)
        break
      case 'maximize':
        globalThis.api.invoke('window-maximize-toggle').catch(console.error)
        break
      case 'close':
        globalThis.api.invoke('window-close').catch(console.error)
        break
      default:
        console.warn(`Unhandled action for label: ${label}`)
    }
  }

  return (
    <Button
      aria-label={label}
      style={{ height: '40px', width: '40px' }}
      appearance="subtle"
      icon={icon}
      onClick={handleAction}
    ></Button>
  )
}
