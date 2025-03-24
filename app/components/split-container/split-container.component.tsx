/*
 * Filename: f:\Projekte\PullRequestManager\src\renderer\components\split-container\split-container.component.ts
 * Path: f:\Projekte\PullRequestManager
 * Created Date: Wednesday, November 27th 2024, 8:58:19 pm
 * Author: Necati Meral https://meral.cloud
 *
 * Copyright (c) 2024 Meral IT
 */
import { tokens } from '@fluentui/react-components'
import React, { ReactNode } from 'react'

interface Props {
  sidebarContent?: ReactNode
  mainContent?: ReactNode
}

export default function SplitContainer({ sidebarContent = null, mainContent = null }: Props) {
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
