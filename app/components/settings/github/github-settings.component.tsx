import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Link,
  SpinButton,
  Textarea,
  Title1,
  makeResetStyles,
  tokens,
} from '@fluentui/react-components'
import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { createGitHubAccess, GitHubFeature } from '@/lib/models/github-access'
import { SettingsContext } from '../context'

const useStack = makeResetStyles({ display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL })
const features: [GitHubFeature, string][] = [
  ['pullRequests', 'Pull requests (Read)'],
  ['reviews', 'Reviews (Read)'],
  ['checks', 'Checks (Read)'],
  ['statuses', 'Commit statuses (Read)'],
  ['teams', 'Team membership'],
  ['approval', 'Pull requests (Read & write)'],
]

export default function GitHubSettings() {
  const className = useStack()
  const { state, actions, selectedIntegrationId, validatingGitHub, githubAccess, githubValidation } =
    useContext(SettingsContext)
  const navigate = useNavigate()
  const integration = state.integrations.find((item) => item.id === selectedIntegrationId)
  if (integration?.type !== 'github') return null
  const access = githubAccess ?? createGitHubAccess()
  return (
    <div className={className}>
      <Title1 as="h1">{integration.name || 'GitHub integration'}</Title1>
      <Field label="Integration name">
        <Input
          name="integrationName"
          value={integration.name}
          onChange={(_, data) => actions.updateIntegration(integration.id, { name: data.value })}
        />
      </Field>
      <Field label="Repositories" hint="One owner/repository name per line, for example acme/widget. GitHub.com only.">
        <Textarea
          name="githubRepositories"
          value={integration.repositories.join('\n')}
          resize="vertical"
          onChange={(_, data) => actions.updateIntegration(integration.id, { repositories: data.value.split('\n') })}
        />
      </Field>
      <Field
        label="Personal Access Token"
        hint="Select these repositories and grant Pull requests read access, Checks read, and Commit statuses read. Approvals and review dismissal need Pull requests write access."
      >
        <Input
          name="githubPat"
          type="password"
          value={integration.pat}
          onChange={(_, data) => actions.updateIntegration(integration.id, { pat: data.value })}
        />
      </Field>
      <Link href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
        Create a GitHub token
      </Link>
      <p>
        Classic tokens need repo access for private repositories and read:org for team visibility. Fine-grained tokens
        report teams only in their resource-owner organization. Organization approval or SSO authorization may also be
        required.
      </p>
      <Field
        validationState={githubValidation?.error ? 'error' : 'none'}
        validationMessage={
          githubValidation ? (
            <output>{githubValidation.error ?? `Connected as ${githubValidation.userDisplayName}`}</output>
          ) : undefined
        }
      >
        <Button onClick={actions.validateGitHub} disabled={validatingGitHub}>
          {validatingGitHub ? 'Validating...' : githubValidation ? 'Recheck access' : 'Validate connection'}
        </Button>
      </Field>
      <section aria-label="GitHub feature access" aria-busy={validatingGitHub}>
        <ul>
          {features.map(([feature, label]) => {
            const result = access.features[feature]
            return (
              <li key={feature}>
                <strong>{label}</strong>{' '}
                <Badge
                  color={result.status === 'verified' ? 'success' : result.status === 'denied' ? 'danger' : 'warning'}
                >
                  {result.status === 'verified'
                    ? 'Verified'
                    : result.status === 'denied'
                      ? 'Access denied'
                      : 'Not verified'}
                </Badge>
                <p>{result.message}</p>
              </li>
            )
          })}
        </ul>
      </section>
      <Field label="Smart Approval" hint="Approve when you or a verified team are reviewers, or nobody is requested.">
        <Checkbox
          label="Enable smart approval"
          checked={integration.intelligentApproval}
          onChange={(_, data) =>
            actions.updateIntegration(integration.id, { intelligentApproval: data.checked === true })
          }
        />
      </Field>
      <Field label="Refresh interval in seconds">
        <SpinButton
          value={integration.updateInterval}
          min={1}
          max={3000}
          onChange={(_, data) => {
            const interval = data.value ?? Number(data.displayValue)
            if (Number.isFinite(interval)) actions.updateIntegration(integration.id, { updateInterval: interval })
          }}
        />
      </Field>
      <p>“Dismiss my review” leaves a reason in the PR conversation and may be restricted by repository rules.</p>
      <Button
        onClick={() => {
          const next = state.integrations.find((item) => item.id !== integration.id)
          actions.deleteIntegration(integration.id)
          navigate(next ? `/settings/integrations/${next.id}` : '/settings/integrations')
        }}
      >
        Remove integration
      </Button>
    </div>
  )
}
