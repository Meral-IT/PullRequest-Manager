import { Checkbox } from '@fluentui/react-components'
import { useContext } from 'react'
import { SettingsContext } from '../context'

export default function GeneralSettings() {
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { state, actions } = useSettings()

  return (
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
  )
}
