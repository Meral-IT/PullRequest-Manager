export interface TitlebarMenu {
  name: string
  items: TitlebarMenuItem[]
}

export interface TitlebarMenuItem {
  name: string
  subText?: string
  action?: string
  actionParams?: (string | number | object)[]
  actionCallback?: () => void
  shortcut?: string
  items?: TitlebarMenuItem[]
}

export const menuItems: TitlebarMenu[] = [
  {
    name: 'File',
    items: [
      {
        name: 'Pull-Requests',
        shortcut: 'Ctrl+H',
        action: 'navigate',
        actionParams: ['/'],
      },
      {
        name: 'Preferences',
        shortcut: 'Ctrl+;',
        action: 'navigate',
        actionParams: ['/settings'],
        items: [
          {
            name: 'General',
            action: 'navigate',
            actionParams: ['/settings/general'],
          },
          {
            name: 'Appearance',
            action: 'navigate',
            actionParams: ['/settings/appearance'],
          },
          {
            name: 'Azure DevOps',
            action: 'navigate',
            actionParams: ['/settings/azure-devops'],
          },
          {
            name: 'Profiles',
            action: 'navigate',
            actionParams: ['/settings/profiles'],
          },
        ],
      },
      {
        name: '---',
      },
      {
        name: 'Exit',
        action: 'app-exit',
      },
    ],
  },
  {
    name: 'Edit',
    items: [
      {
        name: 'Undo',
        action: 'web-undo',
        shortcut: 'Ctrl+Z',
      },
      {
        name: 'Redo',
        action: 'web-redo',
        shortcut: 'Ctrl+Y',
      },
      {
        name: '---',
      },
      {
        name: 'Cut',
        action: 'web-cut',
        shortcut: 'Ctrl+X',
      },
      {
        name: 'Copy',
        action: 'web-copy',
        shortcut: 'Ctrl+C',
      },
      {
        name: 'Paste',
        action: 'web-paste',
        shortcut: 'Ctrl+V',
      },
      {
        name: 'Delete',
        action: 'web-delete',
      },
      {
        name: '---',
      },
      {
        name: 'Select All',
        action: 'web-select-all',
        shortcut: 'Ctrl+A',
      },
    ],
  },
  {
    name: 'View',
    items: [
      {
        name: 'Reload',
        action: 'web-reload',
        shortcut: 'Ctrl+R',
      },
      {
        name: 'Force Reload',
        action: 'web-force-reload',
        shortcut: 'Ctrl+Shift+R',
      },
      {
        name: 'Toggle Developer Tools',
        action: 'web-toggle-devtools',
        shortcut: 'Ctrl+Shift+I',
      },
      {
        name: '---',
      },
      {
        name: 'Actual Size',
        action: 'web-actual-size',
        shortcut: 'Ctrl+0',
      },
      {
        name: 'Zoom In',
        action: 'web-zoom-in',
        shortcut: 'Ctrl++',
      },
      {
        name: 'Zoom Out',
        action: 'web-zoom-out',
        shortcut: 'Ctrl+-',
      },
      {
        name: '---',
      },
      {
        name: 'Toggle Fullscreen',
        action: 'web-toggle-fullscreen',
        shortcut: 'F11',
      },
    ],
  },
  {
    name: 'Window',
    items: [
      {
        name: 'Maximize',
        action: 'window-maximize-toggle',
        shortcut: 'Toggle',
      },
      {
        name: 'Minimize',
        action: 'window-minimize',
        shortcut: 'Ctrl+M',
      },
      {
        name: 'Close',
        action: 'window-close',
        shortcut: 'Ctrl+W',
      },
    ],
  },
  {
    name: 'Credits',
    items: [
      {
        name: 'Necati Meral',
        action: 'web-open-url',
        actionParams: ['https://github.com/NecatiMeral'],
        shortcut: '@necatimeral',
      },
    ],
  },
]
