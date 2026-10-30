import { Button, Checkbox, Field, Input } from '@fluentui/react-components'
import { useContext, useState } from 'react'
import { SettingsContext } from '../context'

export default function GeneralSettings() {
  const { state, actions } = useContext(SettingsContext)

  const [browseError, setBrowseError] = useState('')

  const onBrowseDirectory = async () => {
    setBrowseError('')
    try {
      const selectedDirectory = await globalThis.api.invoke('select-directory')
      if (!selectedDirectory) {
        return
      }

      const wrapper = {
        target: {
          name: 'repositoriesRootDirectory',
          value: selectedDirectory,
        },
      }

      actions.onChangeHandler(wrapper)
    } catch {
      setBrowseError('Unable to select a directory. Please try again.')
    }
  }

  return (
    <div>
      <Checkbox
        label="Start at system startup"
        name="openAtLogin"
        checked={state.openAtLogin}
        onChange={(e) => {
          const wrapper = {
            target: {
              ...e.target,
              name: 'openAtLogin',
              value: e.target.checked,
            },
          }

          actions.onChangeHandler(wrapper)
        }}
      />

      <Field label="Notifications">
        <Checkbox
          label="Enable desktop notifications for new pull requests"
          name="enableNotifications"
          checked={state.enableNotifications}
          onChange={(e) => {
            const wrapper = {
              target: {
                ...e.target,
                name: 'enableNotifications',
                value: e.target.checked,
              },
            }

            actions.onChangeHandler(wrapper)
          }}
        />
      </Field>

      {state.enableNotifications && (
        <Checkbox
          label="Play sound with notifications"
          name="notificationSound"
          checked={state.notificationSound}
          onChange={(e) => {
            const wrapper = {
              target: {
                ...e.target,
                name: 'notificationSound',
                value: e.target.checked,
              },
            }

            actions.onChangeHandler(wrapper)
          }}
          style={{ marginLeft: '24px' }}
        />
      )}

      <Field
        label="Repositories root directory"
        style={{ marginTop: '16px' }}
        validationState={browseError ? 'error' : undefined}
        validationMessage={browseError}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <Input value={state.repositoriesRootDirectory} readOnly style={{ flexGrow: 1 }} />
          <Button onClick={onBrowseDirectory}>Browse…</Button>
        </div>
      </Field>
    </div>
  )
}
