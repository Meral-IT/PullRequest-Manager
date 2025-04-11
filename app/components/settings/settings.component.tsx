import { Button, Field, makeStyles, SelectTabData, SelectTabEvent, Tab, TabList } from '@fluentui/react-components'
import {
  HomeFilled,
  KeyFilled,
  LayerDiagonalPersonFilled,
  PaintBrushFilled,
  SettingsFilled,
} from '@fluentui/react-icons'
import { useContext } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import SplitContainer from '../split-container/split-container.component'
import { SettingsContext } from './context'

const useStyles = makeStyles({
  gap: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  fullWidth: { width: '100%', flexGrow: 1 },
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  bottom: { marginTop: 'auto' },
})

export default function SettingsComponent() {
  const styles = useStyles()
  const nav = useNavigate()
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { actions, saving } = useSettings()

  const onTabSelect = (_: SelectTabEvent, data: SelectTabData) => {
    if (data.value) {
      nav(data.value)
    }
  }

  const loc = useLocation()
  let pathName = loc.pathname
  if (loc.pathname === '/settings') {
    pathName = '/settings/general'
  }

  const buttonContent = saving ? 'Saving settings' : 'Save Settings'

  return (
    <SplitContainer
      sidebarContent={
        <div className={styles.gap}>
          <Button icon={<HomeFilled />} className={styles.fullWidth} onClick={() => nav('/')}>
            Home
          </Button>

          <TabList vertical appearance="subtle" selectedValue={pathName} onTabSelect={onTabSelect}>
            <Tab icon={<SettingsFilled />} value="/settings/general">
              General
            </Tab>
            <Tab icon={<PaintBrushFilled />} value="/settings/appearance">
              Appearance
            </Tab>
            <Tab icon={<KeyFilled />} value="/settings/azure-devops">
              Azure DevOps
            </Tab>
            <Tab icon={<LayerDiagonalPersonFilled />} value="/settings/profiles">
              Profiles
            </Tab>
          </TabList>
        </div>
      }
      mainContent={
        <div className={styles.container}>
          <Outlet />
          <Field className={(styles.fullWidth, styles.bottom)}>
            <Button onClick={actions.saveSettings} appearance="primary" disabled={saving}>
              {buttonContent}
            </Button>
          </Field>
        </div>
      }
    />
  )
}
