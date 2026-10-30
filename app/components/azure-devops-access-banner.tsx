import { AzureDevOpsAccess, getAccessNoticeRequirements } from '@/lib/models/azure-devops-access'
import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from '@fluentui/react-components'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AzureDevOpsAccessBanner({ access }: Readonly<{ access?: AzureDevOpsAccess }>) {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!access) return null
  const requirements = getAccessNoticeRequirements(access)
  if (!requirements.length) return null
  const denied = requirements.some(({ id }) => access.features[id].status === 'denied')
  const canAcknowledge =
    !access.acknowledged && requirements.some(({ id }) => access.features[id].status === 'unverified')

  const acknowledge = async () => {
    setSaving(true)
    setError('')
    try {
      const saved = await globalThis.api.invoke('acknowledge-azure-devops-requirements', {
        requirementsFingerprint: access.requirementsFingerprint,
        connectionRevision: access.connectionRevision,
      })
      if (!saved) setError('The connection changed. Review its current requirements and try again.')
    } catch {
      setError('Could not save your acknowledgement. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <MessageBar
      intent={denied ? 'warning' : 'info'}
      role={denied ? 'alert' : 'status'}
      layout="multiline"
      aria-label="Azure DevOps access notice"
    >
      <MessageBarBody>
        <MessageBarTitle>
          {denied ? 'Azure DevOps access needs attention' : 'Review Azure DevOps scope requirements'}
        </MessageBarTitle>
        {requirements
          .map(
            (requirement) =>
              `${requirement.features}: ${requirement.label} (${requirement.required ? 'required' : 'optional'}, ${access.features[requirement.id].status === 'denied' ? 'access denied' : 'not verified'})`
          )
          .join('; ')}
        .{denied && ' Check PAT scopes and Azure DevOps permissions.'}
        {error && <p role="alert">{error}</p>}
      </MessageBarBody>
      <MessageBarActions>
        <Button onClick={() => navigate('/settings/azure-devops')}>Azure DevOps settings</Button>
        {canAcknowledge && (
          <Button onClick={acknowledge} disabled={saving}>
            {saving ? 'Saving...' : 'Acknowledge unverified'}
          </Button>
        )}
      </MessageBarActions>
    </MessageBar>
  )
}
