import {
  Button,
  Badge,
  Checkbox,
  Field,
  Input,
  Link,
  makeResetStyles,
  makeStyles,
  SpinButton,
  Spinner,
  tokens,
} from '@fluentui/react-components'
import { CheckmarkFilled, DismissFilled } from '@fluentui/react-icons'
import { useContext } from 'react'
import { SettingsContext } from '../context'
import { azureDevOpsRequirements, createAzureDevOpsAccess } from '@/lib/models/azure-devops-access'

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
})

const useStyles = makeStyles({
  requirements: {
    listStyleType: 'none',
    paddingLeft: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  scopeHeading: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  explanation: { marginTop: tokens.spacingVerticalXS, marginBottom: 0, color: tokens.colorNeutralForeground2 },
})

export default function AzureDevOpsSettings() {
  const styles = useStyles()
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { state, actions, validatingAzDo, azDoAccess, azDoValidation } = useSettings()
  const access = azDoAccess ?? createAzureDevOpsAccess()

  let validatingIcon: React.ReactNode = undefined
  if (validatingAzDo) {
    validatingIcon = <Spinner size="tiny" />
  } else if (azDoValidation && !azDoValidation.error) {
    validatingIcon = <CheckmarkFilled />
  } else if (azDoValidation?.error) {
    validatingIcon = <DismissFilled />
  }

  const isValidOrganizationUrl = state.azDoOrganizationUrl.match(/https:\/\/dev\.azure\.com\/[a-zA-Z0-9-]+/g)
  const patUrl = `${state.azDoOrganizationUrl}/_usersSettings/tokens`

  const InfoLabel = isValidOrganizationUrl ? (
    <span>
      Personal Access Token{' '}
      <Link href={patUrl} target="_blank" rel="noreferrer">
        (Create one here)
      </Link>
    </span>
  ) : (
    <span>Personal Access Token</span>
  )

  return (
    <div className={useStackClassName()}>
      <Field label="Organization URL" hint="https://dev.azure.com/organization">
        <Input name="azDoOrganizationUrl" value={state.azDoOrganizationUrl} onChange={actions.onChangeHandler} />
      </Field>
      <Field label="Project" hint="The project name">
        <Input name="azDoProject" value={state.azDoProject} onChange={actions.onChangeHandler} />
      </Field>
      <Field
        label={InfoLabel}
        hint="The full PAT scope list cannot be retrieved automatically. The checks below verify feature access, not token metadata."
      >
        <Input name="azDoPat" value={state.azDoPat} onChange={actions.onChangeHandler} type="password" />
      </Field>
      <Field
        validationState={azDoValidation?.error ? 'error' : 'none'}
        validationMessage={
          azDoValidation ? (
            <span role="status">{azDoValidation.error ?? `Connected as ${azDoValidation.userDisplayName}`}</span>
          ) : undefined
        }
      >
        <Button onClick={actions.validateAzDo} disabled={validatingAzDo} icon={validatingIcon}>
          {validatingAzDo ? 'Validating...' : azDoValidation ? 'Recheck access' : 'Validate connection'}
        </Button>
      </Field>
      <section aria-label="PAT scope requirements" aria-busy={validatingAzDo}>
        <ul className={styles.requirements}>
          {azureDevOpsRequirements.map((requirement) => {
            const result = access.features[requirement.id]
            const status =
              result.status === 'verified' ? 'Verified' : result.status === 'denied' ? 'Access denied' : 'Not verified'
            return (
              <li key={requirement.id}>
                <div className={styles.scopeHeading}>
                  <strong>{requirement.label}</strong>
                  <span>{requirement.required ? 'Required' : 'Optional'}</span>
                  <Badge
                    appearance="tint"
                    color={result.status === 'verified' ? 'success' : result.status === 'denied' ? 'danger' : 'warning'}
                  >
                    {status}
                  </Badge>
                </div>
                <p className={styles.explanation}>
                  {requirement.features} · <code>{requirement.scope}</code>
                </p>
                <p className={styles.explanation}>{result.message}</p>
              </li>
            )
          })}
        </ul>
      </section>

      <Field
        label="Smart Approval"
        hint="Enable smart approval for pull requests by only approving the changes that matter."
      >
        <Checkbox
          label={'Enable smart approval'}
          name="azDoIntelligentApproval"
          checked={state.azDoIntelligentApproval}
          onChange={(e) => {
            const wrapper = {
              target: {
                ...e.target,
                name: 'azDoIntelligentApproval',
                value: e.target.checked,
              },
            }

            actions.onChangeHandler(wrapper)
          }}
        />
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
    </div>
  )
}
