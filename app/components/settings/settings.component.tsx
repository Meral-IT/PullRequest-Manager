import {
  Body1Strong,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Divider,
  Field,
  makeStyles,
  SelectTabData,
  SelectTabEvent,
  Tab,
  TabList,
  tokens,
} from '@fluentui/react-components'
import {
  AddFilled,
  HomeFilled,
  KeyFilled,
  LayerRegular,
  PaintBrushFilled,
  SettingsFilled,
  WarningRegular,
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
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    rowGap: tokens.spacingVerticalM,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflowY: 'auto',
  },
  bottom: { flexShrink: 0 },
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
  profileError: {
    color: tokens.colorStatusDangerForeground1,
  },
})

export default function SettingsComponent() {
  const styles = useStyles()
  const nav = useNavigate()
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { actions, saving, saveError, state, selectedIntegrationId } = useSettings()

  const onTabSelect = (_: SelectTabEvent, data: SelectTabData) => {
    if (data.value === '/settings/integrations/new') {
      nav(`/settings/integrations/${actions.addIntegration()}`)
      return
    }
    const integration = state.azDoIntegrations.find((item) => `/settings/integrations/${item.id}` === data.value)
    if (integration && integration.id !== selectedIntegrationId) actions.selectIntegration(integration.id)
    if (data.value) {
      nav(data.value)
    }
  }

  const isValid = state.profiles.every((p) => p.filterValid)

  const loc = useLocation()
  let pathName = loc.pathname
  if (loc.pathname === '/settings') {
    pathName = '/settings/general'
  }
  if (['/settings/azure-devops', '/settings/integrations'].includes(loc.pathname)) {
    pathName = `/settings/integrations/${selectedIntegrationId}`
  }

  let buttonContent: string
  if (saving) {
    buttonContent = 'Saving settings'
  } else if (isValid) {
    buttonContent = 'Save Settings'
  } else {
    buttonContent = 'Invalid Profile(s)'
  }
  const [open, setOpen] = useState(false)
  const [loadError, setLoadError] = useState('')
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
    setLoadError('')
    try {
      const hasUnsavedChanges = JSON.stringify(state) !== JSON.stringify(await actions.getInitialSettings())
      if (hasUnsavedChanges) setOpen(true)
      else nav('/')
    } catch {
      setLoadError('Unable to check for unsaved changes. Please try again.')
    }
  }

  const profiles = state.profiles.map((profile) => {
    const profileUri = `/settings/profiles/${profile.id}`
    return (
      <Tab
        icon={profile.filterValid ? <LayerRegular /> : <WarningRegular className={styles.profileError} />}
        value={profileUri}
        key={profile.id}
      >
        {profile.label}
      </Tab>
    )
  })

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
            </TabList>
            <Divider />
            <Body1Strong>Integrations</Body1Strong>
            <TabList
              vertical
              appearance="subtle"
              aria-label="Integrations"
              selectedValue={pathName}
              onTabSelect={onTabSelect}
            >
              {state.azDoIntegrations.map((integration) => (
                <Tab icon={<KeyFilled />} value={`/settings/integrations/${integration.id}`} key={integration.id}>
                  {integration.name || integration.project || 'Unnamed integration'}
                </Tab>
              ))}
              <Tab icon={<AddFilled />} value="/settings/integrations/new">
                Add Integration
              </Tab>
            </TabList>
            <Divider></Divider>
            <Body1Strong>Profiles</Body1Strong>

            <TabList vertical appearance="subtle" selectedValue={pathName} onTabSelect={onTabSelect}>
              {profiles}
              <Tab icon={<AddFilled />} value="/settings/profiles/new">
                Add new Profile
              </Tab>
            </TabList>
          </div>
        }
        mainContent={
          <div className={styles.container}>
            <div className={styles.content}>
              <Outlet />
            </div>
            <Field
              className={styles.bottom}
              validationState={saveError || loadError ? 'error' : undefined}
              validationMessage={
                saveError || loadError ? <span role="alert">{saveError || loadError}</span> : undefined
              }
            >
              <Button onClick={actions.saveSettings} appearance="primary" disabled={saving || !isValid}>
                {buttonContent}
              </Button>
            </Field>
          </div>
        }
      />
    </>
  )
}
