import { Combobox, Option, Field, makeResetStyles, tokens } from '@fluentui/react-components'
import { useContext } from 'react'
import { SettingsContext, SettingStateProps } from '../context'
import { nameof } from '@/lib/tools/nameof'

interface UiTheme {
  value: string
  displayName: string
}

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
})

export default function AppearanceSettings() {
  const options: UiTheme[] = [
    {
      value: 'system',
      displayName: 'System',
    },
    {
      value: 'light',
      displayName: 'Light',
    },
    {
      value: 'dark',
      displayName: 'Dark',
    },
  ]

  const useSettings = () => {
    return useContext(SettingsContext)
  }
  const { state, actions } = useSettings()

  const item = options.find((option) => option.value === state.appearanceTheme)
  if (!item) {
    throw new Error('Invalid appearance theme')
  }

  return (
    <div className={useStackClassName()}>
      <Field label="Theme">
        <Combobox
          name={nameof<SettingStateProps>('appearanceTheme')}
          defaultValue={item.displayName}
          defaultSelectedOptions={[state.appearanceTheme]}
          onOptionSelect={(e, data) => {
            actions.onChangeHandler({
              target: {
                name: nameof<SettingStateProps>('appearanceTheme'),
                value: data.optionValue,
              },
            } as any)
          }}
        >
          {options.map((option) => (
            <Option value={option.value} key={option.value}>
              {option.displayName}
            </Option>
          ))}
        </Combobox>
      </Field>
    </div>
  )
}
