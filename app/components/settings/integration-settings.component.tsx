import { Button, Title1 } from '@fluentui/react-components'
import { useContext, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SettingsContext } from './context'
import AzureDevOpsSettings from './azdo/settings-azdo.component'
import GitHubSettings from './github/github-settings.component'

export default function IntegrationSettings() {
  const { state, actions, selectedIntegrationId } = useContext(SettingsContext)
  const { integrationId } = useParams()
  const navigate = useNavigate()
  const integration = state.integrations.find((item) => item.id === (integrationId ?? selectedIntegrationId))
  useEffect(() => {
    if (integration && integration.id !== selectedIntegrationId) actions.selectIntegration(integration.id)
  }, [integration, selectedIntegrationId, actions])
  if (integrationId === 'new' || (!integrationId && !integration))
    return (
      <>
        <Title1 as="h1">Add Integration</Title1>
        <p>Choose a provider for this connection.</p>
        <Button onClick={() => navigate(`/settings/integrations/${actions.addIntegration('azure-devops')}`)}>
          Azure DevOps
        </Button>
        <Button onClick={() => navigate(`/settings/integrations/${actions.addIntegration('github')}`)}>GitHub</Button>
      </>
    )
  if (!integration) return <p>Integration not found. Use Add Integration to create one.</p>
  return integration.type === 'github' ? <GitHubSettings /> : <AzureDevOpsSettings />
}
