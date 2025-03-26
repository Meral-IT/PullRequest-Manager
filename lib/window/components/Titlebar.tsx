import { useEffect, useRef, useState } from 'react'
import { useWindowContext } from './WindowContext'
import { useTitlebarContext } from './TitlebarContext'
import type { TitlebarMenu, TitlebarMenuItem } from '../titlebarMenus'
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
import { useNavigate } from 'react-router-dom'
import { DismissFilled, LineHorizontal1Filled, MaximizeFilled } from '@fluentui/react-icons'

const useStyles = makeStyles({
  titlebar: {
    backgroundColor: tokens.colorNeutralBackground3,
    height: '40px',
  },
  titleBarMenu: {
    display: 'flex',
    flexDirection: 'row',
    gap: '2px',
    position: 'absolute',
    top: '9px',
    left: '42px',
    '-webkit-app-region': 'no-drag',
  },
  titleBarTitle: {
    display: 'flex',
    flexDirection: 'row',
    gap: '2px',
    position: 'absolute',
    top: '9px',
    left: '42px',
    '-webkit-app-region': 'no-drag',
  },
  icon: {
    left: 0,
    top: 0,
    width: '42px',
    height: '100%',
    padding: '0 10px',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',

    '& img': {
      width: '24px',
      height: '24px',
    },
  },
})

export const Titlebar = () => {
  const styles = useStyles()
  const { title, icon, titleCentered, menuItems } = useWindowContext().titlebar
  const { menusVisible, setMenusVisible, closeActiveMenu } = useTitlebarContext()
  const [loaderVisible, setLoaderVisible] = useState(false)
  const wcontext = useWindowContext().window

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && menuItems?.length) {
        // Ignore repeated keydown events
        if (e.repeat) return
        // Close active menu if it's open
        if (menusVisible) closeActiveMenu()
        setMenusVisible(!menusVisible)
      }
    }

    // Add event listener for Alt key
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menusVisible])

  useEffect(() => {
    return window.api.receive('loading', (event) => {
      setLoaderVisible(event.isLoading)
    })
  }, [loaderVisible])

  const titleSpinner = loaderVisible ? (
    <Tooltip content={'Loading...'} relationship="label" withArrow>
      <Spinner size="tiny" />
    </Tooltip>
  ) : null

  // TODO: Implement centered title
  return (
    <div className={['window-titlebar', styles.titlebar].join(' ')}>
      {wcontext?.platform === 'win32' && (
        <div className={styles.icon}>
          <img src={icon} alt="PullRequest-Manager Logo" />
        </div>
      )}

      <div className={styles.titleBarTitle} style={{ visibility: menusVisible ? 'hidden' : 'visible' }}>
        <Button iconPosition="after" icon={titleSpinner} appearance="subtle" size="small">
          {title}
        </Button>
      </div>
      {menusVisible && <TitlebarMenu />}
      {wcontext?.platform === 'win32' && <TitlebarControls />}
    </div>
  )
}

const TitlebarMenu = () => {
  const styles = useStyles()
  const { menuItems } = useWindowContext().titlebar

  // If there are no menu items, hide the menu
  if (!menuItems) return null

  return (
    <div className={styles.titleBarMenu}>
      {menuItems?.map((menu, index) => <TitlebarMenuItem key={index} menu={menu} index={index} />)}
    </div>
  )
}

const TitlebarMenuItem = ({ menu, index }: { menu: TitlebarMenu; index: number }) => {
  const { activeMenuIndex, setActiveMenuIndex } = useTitlebarContext()
  const menuItemRef = useRef<HTMLDivElement | null>(null)

  const handleClickOutside = (event: MouseEvent) => {
    if (
      menuItemRef.current &&
      !menuItemRef.current.contains(event.target as Node) &&
      menuItemRef.current.classList.contains('active')
    ) {
      setActiveMenuIndex(null)
    }
  }

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  useEffect(() => {
    if (activeMenuIndex !== index) {
      menuItemRef.current?.classList.remove('active')
    } else {
      menuItemRef.current?.classList.add('active')
    }
  }, [activeMenuIndex])

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <MenuButton size="small" appearance="subtle">
          {menu.name}
        </MenuButton>
      </MenuTrigger>

      <MenuPopover>
        <MenuList>
          <TitlebarMenuPopup menu={menu} />
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}

const TitlebarMenuPopup = ({ menu }: { menu: TitlebarMenu }) => {
  return (
    <div>
      {menu.items.map((item, index) => (
        <TitlebarMenuPopupItem key={index} item={item} />
      ))}
    </div>
  )
}

const TitlebarMenuPopupItem = ({ item }: { item: TitlebarMenuItem }) => {
  const { setActiveMenuIndex } = useTitlebarContext()
  const nav = useNavigate()

  function handleAction() {
    // Check if the item has a valid action callback
    if (typeof item.actionCallback === 'function') {
      item.actionCallback()
      setActiveMenuIndex(null)
      return
    } else if (item.action === 'navigate' && item.actionParams) {
      // Navigate to the provided route
      const route = item.actionParams[0] as string
      nav(route)
      return
    }

    // Invoke the action with the provided parameters
    window.api.invoke(item.action!, ...(item.actionParams ? item.actionParams : []))
    setActiveMenuIndex(null)
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
            {item.items.map((subItem, index) => (
              <TitlebarMenuPopupItem key={index} item={subItem} />
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
        window.api.invoke('window-minimize')
        break
      case 'maximize':
        window.api.invoke('window-maximize-toggle')
        break
      case 'close':
        window.api.invoke('window-close')
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
