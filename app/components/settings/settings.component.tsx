import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  makeStyles,
  SelectTabData,
  SelectTabEvent,
  Tab,
  TabList,
  tokens,
} from '@fluentui/react-components'
import {
  HomeFilled,
  KeyFilled,
  LayerDiagonalPersonFilled,
  PaintBrushFilled,
  SettingsFilled,
} from '@fluentui/react-icons'
import { useContext, useState } from 'react'
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
  dangerButton: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    ':hover': {
      backgroundColor: tokens.colorStatusDangerBackground3Hover,
    },
    ':active': {
      backgroundColor: tokens.colorStatusDangerBackground3Pressed,
    },
    ':focus': {
      backgroundColor: tokens.colorStatusDangerBackground3Pressed,
    },
  },
})

export default function SettingsComponent() {
  const styles = useStyles()
  const nav = useNavigate()
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { actions, saving, state } = useSettings()

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
  const [open, setOpen] = useState(false)
  const unsavedChangesDialog = (
    <Dialog
      // this controls the dialog open state
      open={open}
      onOpenChange={(_, data) => {
        // it is the users responsibility to react accordingly to the open state change
        setOpen(data.open)
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogContent>
            <p>You have unsaved changes. Are you sure you want to leave?</p>
            <p>Any unsaved changes will be lost.</p>
          </DialogContent>

          <DialogActions>
            <Button
              appearance="secondary"
              onClick={() => {
                setOpen(false)
              }}
            >
              Stay
            </Button>
            {/* DialogTrigger inside of a Dialog still works properly */}
            <DialogTrigger disableButtonEnhancement>
              <Button
                className={styles.dangerButton}
                appearance="secondary"
                onClick={() => {
                  setOpen(false)
                  nav('/')
                }}
              >
                Leave
              </Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
  const onHomeClick = async () => {
    const hasUnsavedChanges = JSON.stringify(state) !== JSON.stringify(await actions.getInitialSettings())
    if (hasUnsavedChanges) {
      setOpen(true)
    } else {
      nav('/')
    }
  }

  return (
    <>
      {unsavedChangesDialog}
      <SplitContainer
        sidebarContent={
          <div className={styles.gap}>
            <Button icon={<HomeFilled />} className={styles.fullWidth} onClick={onHomeClick}>
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
    </>
  )
}
