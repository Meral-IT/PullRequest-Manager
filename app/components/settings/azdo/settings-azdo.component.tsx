import {
  Button,
  buttonClassNames,
  Field,
  Input,
  makeResetStyles,
  makeStyles,
  SpinButton,
  Spinner,
  tokens,
} from '@fluentui/react-components'
import { useContext } from 'react'
import { SettingsContext } from '../context'
import { CheckmarkFilled, DismissFilled } from '@fluentui/react-icons'

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
})

const useStyles = makeStyles({
  // Disable interaction
  loadingButton: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    color: tokens.colorNeutralForeground1,
    cursor: 'default',
    pointerEvents: 'none',
  },
  // Negative feedback
  failedButton: {
    [`& .${buttonClassNames.icon}`]: {
      color: tokens.colorStatusDangerForeground1,
    },
  },
  // Positive feedback
  succeededButton: {
    [`& .${buttonClassNames.icon}`]: {
      color: tokens.colorStatusSuccessForeground1,
    },
  },
})

export default function AzureDevOpsSettings() {
  const styles = useStyles()
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { state, actions, validatingAzDo } = useSettings()

  const validateAgain = ' - Validate again?'
  const validatingText = validatingAzDo
    ? 'Validating...'
    : state.azDoValidationState === 'success'
      ? state.azDoValidationMessage
      : state.azDoValidationState === 'error'
        ? state.azDoValidationMessage + validateAgain
        : 'Validate'

  const validatingIcon = validatingAzDo ? (
    <Spinner size="tiny" />
  ) : state.azDoValidationState === 'success' ? (
    <CheckmarkFilled />
  ) : state.azDoValidationState === 'error' ? (
    <DismissFilled />
  ) : undefined

  const buttonClass = validatingAzDo
    ? styles.loadingButton
    : state.azDoValidationState === 'success'
      ? styles.succeededButton
      : state.azDoValidationState === 'error'
        ? styles.failedButton
        : undefined

  return (
    <div className={useStackClassName()}>
      <Field label="Organization URL" hint="https://dev.azure.com/organization">
        <Input name="azDoOrganizationUrl" value={state.azDoOrganizationUrl} onChange={actions.onChangeHandler} />
      </Field>
      <Field label="Project" hint="The project name">
        <Input name="azDoProject" value={state.azDoProject} onChange={actions.onChangeHandler} />
      </Field>
      <Field label="Personal access token" hint="Your personal access token">
        <Input name="azDoPat" value={state.azDoPat} onChange={actions.onChangeHandler} type="password" />
      </Field>
      <Field label="Refresh interval in seconds" hint="The interval in seconds to refresh the pull requests">
        <SpinButton
          name="azDoInterval"
          value={state.azDoInterval}
          onChange={actions.onChangeHandler}
          min={1}
          max={3000}
        ></SpinButton>
      </Field>
      <Field>
        <Button className={buttonClass} onClick={actions.validateAzDo} disabled={validatingAzDo} icon={validatingIcon}>
          {validatingText}
        </Button>
      </Field>
    </div>
  )
}
