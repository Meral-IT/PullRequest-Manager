import { tokens } from '@fluentui/react-components'
import { ReactNode } from 'react'

interface Props {
  sidebarContent?: ReactNode
  mainContent?: ReactNode
}

export default function SplitContainer({ sidebarContent = null, mainContent = null }: Readonly<Props>) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          height: '100%',
          width: 200,
          display: 'flex',
          flexDirection: 'column',
          borderRightWidth: 1,
          borderRightColor: tokens.colorNeutralStroke3,
          borderRightStyle: 'solid',
          gap: 10,
          padding: 20,
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        {sidebarContent}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          gap: 20,
          padding: 20,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ flexGrow: 1 }}>{mainContent}</div>
      </div>
    </div>
  )
}
