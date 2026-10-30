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
  Title1,
  tokens,
} from '@fluentui/react-components'
import { CheckmarkFilled, DismissFilled } from '@fluentui/react-icons'
import { useContext, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SettingsContext } from '../context'
import { azureDevOpsRequirements, createAzureDevOpsAccess } from '@/lib/models/azure-devops-access'

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
})

const useStyles = makeStyles({
  heading: { margin: 0 },
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

const accessStatuses = {
  verified: { label: 'Verified', color: 'success' },
  denied: { label: 'Access denied', color: 'danger' },
  unverified: { label: 'Not verified', color: 'warning' },
} as const

export default function AzureDevOpsSettings() {
  const styles = useStyles()
  const useSettings = () => {
    return useContext(SettingsContext)
  }

  const { state, actions, selectedIntegrationId, validatingAzDo, azDoAccess, azDoValidation } = useSettings()
  const { integrationId } = useParams()
  const navigate = useNavigate()
  const integration = state.azDoIntegrations.find((item) => item.id === selectedIntegrationId)
  useEffect(() => {
    if (
      integrationId &&
      integrationId !== selectedIntegrationId &&
      state.azDoIntegrations.some((item) => item.id === integrationId)
    )
      actions.selectIntegration(integrationId)
  }, [integrationId, selectedIntegrationId, state.azDoIntegrations, actions])
  const stackClassName = useStackClassName()
  const access = azDoAccess ?? createAzureDevOpsAccess()
  let validationLabel = 'Validate connection'
  if (azDoValidation) validationLabel = 'Recheck access'
  if (validatingAzDo) validationLabel = 'Validating...'

  let validatingIcon: React.ReactNode = undefined
  if (validatingAzDo) {
    validatingIcon = <Spinner size="tiny" />
  } else if (azDoValidation && !azDoValidation.error) {
    validatingIcon = <CheckmarkFilled />
  } else if (azDoValidation?.error) {
    validatingIcon = <DismissFilled />
  }

  const isValidOrganizationUrl = (integration?.organizationUrl ?? '').match(/https:\/\/dev\.azure\.com\/[a-zA-Z0-9-]+/g)
  const patUrl = `${integration?.organizationUrl ?? ''}/_usersSettings/tokens`

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
    <div className={stackClassName}>
      {!integration && <p>No integrations configured. Use Add Integration to create one.</p>}
      {integration && (
        <>
          <Title1 as="h1" className={styles.heading}>
            {integration.name || integration.project || 'Azure DevOps integration'}
          </Title1>
          <Field label="Integration name">
            <Input
              name="integrationName"
              value={integration.name}
              onChange={(_, data) => actions.updateIntegration(integration.id, { name: data.value })}
            />
          </Field>
          <Field label="Organization URL" hint="https://dev.azure.com/organization">
            <Input
              name="azDoOrganizationUrl"
              value={integration.organizationUrl}
              onChange={(_, data) => actions.updateIntegration(integration.id, { organizationUrl: data.value })}
            />
          </Field>
          <Field label="Project" hint="The project name or ID">
            <Input
              name="azDoProject"
              value={integration.project}
              onChange={(_, data) => actions.updateIntegration(integration.id, { project: data.value })}
            />
          </Field>
          <Field
            label={InfoLabel}
            hint="The full PAT scope list cannot be retrieved automatically. The checks below verify feature access, not token metadata."
          >
            <Input
              name="azDoPat"
              value={integration.pat}
              onChange={(_, data) => actions.updateIntegration(integration.id, { pat: data.value })}
              type="password"
            />
          </Field>
          <Field
            validationState={azDoValidation?.error ? 'error' : 'none'}
            validationMessage={
              azDoValidation ? (
                <output>{azDoValidation.error ?? `Connected as ${azDoValidation.userDisplayName}`}</output>
              ) : undefined
            }
          >
            <Button onClick={actions.validateAzDo} disabled={validatingAzDo} icon={validatingIcon}>
              {validationLabel}
            </Button>
          </Field>
          <section aria-label="PAT scope requirements" aria-busy={validatingAzDo}>
            <ul className={styles.requirements}>
              {azureDevOpsRequirements.map((requirement) => {
                const result = access.features[requirement.id]
                const status = accessStatuses[result.status]
                return (
                  <li key={requirement.id}>
                    <div className={styles.scopeHeading}>
                      <strong>{requirement.label}</strong>
                      <span>{requirement.required ? 'Required' : 'Optional'}</span>
                      <Badge appearance="tint" color={status.color}>
                        {status.label}
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
              checked={integration.intelligentApproval}
              onChange={(_, data) =>
                actions.updateIntegration(integration.id, { intelligentApproval: data.checked === true })
              }
            />
          </Field>
          <Field label="Refresh interval in seconds" hint="The interval in seconds to refresh the pull requests">
            <SpinButton
              name="azDoInterval"
              value={integration.updateInterval}
              onChange={(_, data) => {
                const interval = data.value ?? Number(data.displayValue)
                if (Number.isFinite(interval)) actions.updateIntegration(integration.id, { updateInterval: interval })
              }}
              min={1}
              max={3000}
            ></SpinButton>
          </Field>
          <Button
            onClick={() => {
              const next = state.azDoIntegrations.find((item) => item.id !== integration.id)
              actions.deleteIntegration(integration.id)
              navigate(next ? `/settings/integrations/${next.id}` : '/settings/integrations')
            }}
          >
            Remove integration
          </Button>
        </>
      )}
    </div>
  )
}
