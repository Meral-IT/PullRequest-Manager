import { Field, makeResetStyles, makeStyles, Textarea, tokens } from '@fluentui/react-components'
import { useContext } from 'react'
import { SettingsContext } from '../context'

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
})

const useStyles = makeStyles({
  height: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    flexGrow: 1,
  },
})

export default function ProfileSettings() {
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { state, actions } = useSettings()
  const stack = useStackClassName()
  const styles = useStyles()

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const profiles = JSON.parse(e.target.value)
      actions.onChangeHandler({
        target: {
          name: 'profiles',
          value: profiles,
        },
      })
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className={stack}>
      <Field label="Profiles JSON" className={styles.height}>
        <Textarea
          className={styles.height}
          resize="vertical"
          name="profiles"
          value={JSON.stringify(state.profiles, null, 2)}
          onChange={onChange}
        />
      </Field>
    </div>
  )
}
