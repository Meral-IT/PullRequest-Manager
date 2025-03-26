import { Combobox, Option, Field, makeResetStyles, tokens, Select } from '@fluentui/react-components'
import { useContext, useEffect, useState } from 'react'
import { SettingsContext, SettingStateProps } from '../context'
import { nameof } from '@/lib/tools/nameof'
import { TableSize } from '@/lib/models/settings.model'

interface OptionItem {
  value: string
  displayName: string
}

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
})
const themeOptions: OptionItem[] = [
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

const tableSizeOptions: OptionItem[] = [
  {
    value: TableSize.ExtraSmall,
    displayName: 'Extra Small',
  },
  {
    value: TableSize.Small,
    displayName: 'Small',
  },
  {
    value: TableSize.Medium,
    displayName: 'Medium',
  },
]

export default function AppearanceSettings() {
  const { state, actions } = useContext(SettingsContext)
  const [themeItem, setThemeItem] = useState<OptionItem>(
    themeOptions.find((option) => option.value === state.appearanceTheme) || themeOptions[0]
  )

  const [tableSizeItem, setTableSizeItem] = useState<OptionItem>(
    tableSizeOptions.find((option) => option.value === state.appearanceTableSize) || tableSizeOptions[0]
  )

  useEffect(() => {
    setThemeItem(themeOptions.find((option) => option.value === state.appearanceTheme) || themeOptions[0])
  }, [state.appearanceTheme])

  useEffect(() => {
    setTableSizeItem(
      tableSizeOptions.find((option) => option.value === state.appearanceTableSize) || tableSizeOptions[0]
    )
  }, [state.appearanceTableSize])

  return (
    <div className={useStackClassName()}>
      <Field label="Theme">
        <Select
          name={nameof<SettingStateProps>('appearanceTheme')}
          value={themeItem.value}
          onChange={actions.onChangeHandler}
        >
          {themeOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.displayName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Table Size">
        <Select
          name={nameof<SettingStateProps>('appearanceTableSize')}
          value={tableSizeItem.value}
          onChange={actions.onChangeHandler}
        >
          {tableSizeOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.displayName}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
