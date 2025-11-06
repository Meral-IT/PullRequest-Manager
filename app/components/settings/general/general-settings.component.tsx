import { Checkbox, Field, Label } from '@fluentui/react-components'
import { useContext } from 'react'
import { SettingsContext } from '../context'

export default function GeneralSettings() {
  const { state, actions } = useContext(SettingsContext)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
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
        </div>
      </Field>
    </div>
  )
}
