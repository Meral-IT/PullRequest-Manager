import ErrorComponent from '@/app/components/error/error.component'
import PrList from '@/app/components/pr-list/pr-list'
import { ErrorDetail } from '@/lib/models/error-detail'
import { PullRequestData } from '@/lib/models/pr-data'
import { PrProfile } from '@/lib/models/pr-profile'
import { PullRequest } from '@/lib/models/pull-request.model'
import { FilterEvaluator } from '@/lib/models/ui-filter.model'
import type {
  PositioningImperativeRef,
  PositioningShorthand,
  SelectTabData,
  SelectTabEvent,
  TabValue,
} from '@fluentui/react-components'
import { CounterBadge, Menu, MenuItem, MenuList, MenuPopover, Tab, TabList } from '@fluentui/react-components'
import { ThumbLikeFilled } from '@fluentui/react-icons'
import { useEffect, useRef, useState } from 'react'
import './pull-requests.scss'

function PullRequestErrors(error: Readonly<ErrorDetail>) {
  return <ErrorComponent error={error} />
}

function TabHeaderMenu({
  open,
  positioning,
  onClick,
}: Readonly<{
  open: boolean
  positioning: PositioningShorthand
  onClick: () => void
}>) {
  return (
    <Menu open={open} positioning={positioning}>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<ThumbLikeFilled />} onClick={onClick}>
            Approve all
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}

export default function PullRequestsOverview() {
  const positioningRef = useRef<PositioningImperativeRef>(null)
  const [open, setOpen] = useState(false)
  const [selectedValue, setSelectedValue] = useState<TabValue>('builtin:all')
  const [pullRequests, setPullRequests] = useState<PullRequestData>({
    error: null,
    items: [],
  })
  const [menuData, setMenuData] = useState<PullRequest[]>([])
  const [profiles, setProfiles] = useState<PrProfile[]>([])

  useEffect(() => {
    window.api.invoke('get-pr-data').then((data) => {
      if (data) {
        setPullRequests(data)
      }
    })
  }, [])

  useEffect(() => {
    return window.api.receive('pr-data', (data) => {
      setPullRequests(data)
    })
  }, [])

  useEffect(() => {
    window.api.invoke('get-settings').then((settings) => {
      setProfiles(settings.profiles)
      setSelectedValue(settings.profiles.find((profile) => profile.isDefault)?.id ?? 'builtin:all')
    })
  }, [])

  if (pullRequests.error) {
    return PullRequestErrors(pullRequests.error)
  }

  const onTabSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    setSelectedValue(data.value)
  }

  const onHeaderAuxClick = (e) => {
    positioningRef.current?.setTarget(e.target)
    setOpen(!open)
  }

  const onApproveClick = () => {
    window.api.invoke('approve-prs', menuData)
    setOpen(false)
  }

  const details = profiles.map((profile) => {
    const filtered = FilterEvaluator.evaluate(pullRequests.items, profile.filter ?? { filters: [], op: 'AND' })
    const badge = <CounterBadge>{filtered.length}</CounterBadge>
    const onProfileHeaderAuxClick = (e) => {
      setMenuData(filtered)
      onHeaderAuxClick(e)
    }

    const tab: React.ReactNode = (
      <Tab key={profile.id} value={profile.id} onAuxClick={onProfileHeaderAuxClick}>
        {profile.label} {badge}
      </Tab>
    )

    const list: React.ReactNode = selectedValue === profile.id && <PrList key={profile.id} data={filtered} />

    return {
      tab,
      list,
    }
  })

  return (
    <>
      <TabHeaderMenu open={open} positioning={{ positioningRef }} onClick={onApproveClick} />
      <div className="container">
        <div className="section">
          <div className="content header">
            <TabList selectedValue={selectedValue} onTabSelect={onTabSelect}>
              {details.map((detail) => detail.tab)}
            </TabList>
          </div>
          <div className="content scrollable-content">{details.map((detail) => detail.list)}</div>
        </div>
      </div>
    </>
  )
}
