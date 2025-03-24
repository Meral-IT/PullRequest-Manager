import { CounterBadge, Tab, TabList } from '@fluentui/react-components'
import type { SelectTabData, SelectTabEvent, TabValue } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import './pull-requests.scss'
import { ErrorDetail } from '@/lib/models/error-detail'
import ErrorComponent from '@/app/components/error/error.component'
import {
  getPullRequestData,
  registerDataUpdateCallback,
  unregisterDataUpdateCallback,
} from '@/app/services/pull-request.service'
import PrList from '@/app/components/pr-list/pr-list'
import log from 'electron-log/renderer'

function PullRequestErrors(error: ErrorDetail) {
  return <ErrorComponent error={error} />
}

export default function PullRequestsOverview() {
  const profiles = [
    {
      id: 'builtin:all',
      label: 'All',
      isDefault: true,
    },
  ]

  const defaultProfileId = profiles.find((profile) => profile.isDefault)?.id || 'builtin:all'

  const [selectedValue, setSelectedValue] = useState<TabValue>(defaultProfileId)
  const [pullRequests, setPullRequests] = useState(getPullRequestData())

  const onPrDataUpdate = (data) => {
    log.debug('PullRequestChanges Event', data)
    setPullRequests(data)
  }

  useEffect(() => {
    registerDataUpdateCallback(onPrDataUpdate)

    return () => {
      unregisterDataUpdateCallback(onPrDataUpdate)
    }
  }, [])

  if (pullRequests.error) {
    return PullRequestErrors(pullRequests.error)
  }

  const onTabSelect = (event: SelectTabEvent, data: SelectTabData) => {
    setSelectedValue(data.value)
  }

  const tabs = profiles.map((profile) => {
    const badge = <CounterBadge>0</CounterBadge>
    return (
      <Tab key={profile.id} value={profile.id}>
        {profile.label} {badge}
      </Tab>
    )
  })

  const contents = profiles.map((profile) => {
    return selectedValue === profile.id && <PrList key={profile.id} data={pullRequests.items} />
  })

  return (
    <div className="container">
      <div className="section">
        <div className="content header">
          <TabList selectedValue={selectedValue} onTabSelect={onTabSelect}>
            {tabs}
          </TabList>
        </div>
        <div className="content scrollable-content">{contents}</div>
      </div>
    </div>
  )
}
