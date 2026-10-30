import ErrorComponent from '@/app/components/error/error.component'
import AzureDevOpsAccessBanner from '@/app/components/azure-devops-access-banner'
import PrList from '@/app/components/pr-list/pr-list'
import ZeroData from '@/app/components/zero-data/zero-data.component'
import { ErrorDetail, ErrorType } from '@/lib/models/error-detail'
import { PullRequestData } from '@/lib/models/pr-data'
import { PrProfile } from '@/lib/models/pr-profile'
import { PullRequest } from '@/lib/models/pull-request.model'
import type { SettingsModel } from '@/lib/models/settings.model'
import { FilterEvaluator } from '@/lib/models/ui-filter.model'
import { User } from '@/lib/models/user.model'
import { normalizeBranchName } from '@/lib/tools/name-normalizer'
import { matchesPullRequestSearch } from '@/lib/tools/pr-search'
import emptyImage from '@/resources/emptyPRList.svg'
import type {
  MenuItemProps,
  MenuProps,
  PositioningImperativeRef,
  PositioningShorthand,
  TabValue,
} from '@fluentui/react-components'
import {
  Avatar,
  Button,
  CounterBadge,
  Dropdown,
  Input,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Overflow,
  OverflowItem,
  Option,
  Tab,
  TabList,
  Text,
  Tooltip,
  tokens,
  useIsOverflowItemVisible,
  useOverflowMenu,
} from '@fluentui/react-components'
import {
  DismissRegular,
  FilterFilled,
  FilterRegular,
  MoreHorizontalRegular,
  PersonRegular,
  ThumbLikeFilled,
} from '@fluentui/react-icons'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import './pull-requests.scss'

function PullRequestErrors(error: Readonly<ErrorDetail>) {
  return <ErrorComponent error={error} />
}

function TabHeaderMenu({
  open,
  positioning,
  onClick,
  onOpenChange,
}: Readonly<{
  open: boolean
  positioning: PositioningShorthand
  onOpenChange: MenuProps['onOpenChange']
  onClick: () => void
}>) {
  return (
    <Menu open={open} positioning={positioning} onOpenChange={onOpenChange}>
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

/**
 * Props for an overflow menu that displays when there are more tabs than available space
 */
type OverflowMenuProps = {
  onTabSelect?: (tabId: string) => void
  profiles: PrProfile[]
}

/**
 * Props for an overflow menu item that only displays when the tab is not visible
 */
type OverflowMenuItemProps = {
  tab: PrProfile

  onClick: MenuItemProps['onClick']
}

/**
 * A menu item for an overflow menu that only displays when the tab is not visible
 */
const OverflowMenuItem = (props: OverflowMenuItemProps) => {
  const { tab, onClick } = props
  const isVisible = useIsOverflowItemVisible(tab.id)

  if (isVisible) {
    return null
  }

  return <MenuItem onClick={onClick}>{tab.label}</MenuItem>
}

/**
 * Styles for the overflow menu
 */
const useOverflowMenuStyles = makeStyles({
  menu: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  menuButton: {
    alignSelf: 'center',
  },
})

const OverflowMenu = (props: OverflowMenuProps) => {
  const { onTabSelect, profiles } = props
  const { ref, isOverflowing, overflowCount } = useOverflowMenu<HTMLButtonElement>()

  const styles = useOverflowMenuStyles()

  const onItemClick = (tabId: string) => {
    onTabSelect?.(tabId)
  }

  if (!isOverflowing) {
    return null
  }

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          appearance="transparent"
          className={styles.menuButton}
          ref={ref}
          icon={<MoreHorizontalRegular />}
          aria-label={`${overflowCount} more tabs`}
          role="tab"
        />
      </MenuTrigger>
      <MenuPopover>
        <MenuList className={styles.menu}>
          {profiles.map((tab) => (
            <OverflowMenuItem key={tab.id} tab={tab} onClick={() => onItemClick(tab.id)} />
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  )
}

export default function PullRequestsOverview() {
  const positioningRef = useRef<PositioningImperativeRef>(null)
  const [open, setOpen] = useState(false)
  const onOpenChange: MenuProps['onOpenChange'] = (_, data) => {
    setOpen(data.open)
  }
  const [selectedValue, setSelectedValue] = useState<TabValue>('builtin:all')
  const [pullRequests, setPullRequests] = useState<PullRequestData>({
    error: null,
    items: [],
  })
  const [menuData, setMenuData] = useState<PullRequest[]>([])
  const [profiles, setProfiles] = useState<PrProfile[]>([])
  const [filtersVisible, setFiltersVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [createdBy, setCreatedBy] = useState<User | null>(null)
  const [targetBranch, setTargetBranch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const hasFilters = Boolean(searchQuery.trim() || createdBy || targetBranch)

  const openSearch = () => {
    setFiltersVisible(true)
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }

  const clearFilters = (focusInput = true) => {
    setSearchQuery('')
    setCreatedBy(null)
    setTargetBranch('')
    setOpen(false)
    if (focusInput) searchInputRef.current?.focus()
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearch()
    } else if (event.key === 'Escape') {
      clearFilters()
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener('keydown', listener, true)
    return () => document.removeEventListener('keydown', listener, true)
  }, [])

  useEffect(() => {
    if (filtersVisible) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [filtersVisible])

  useEffect(() => {
    setOpen(false)
  }, [pullRequests, profiles])

  const showError = useCallback((error: unknown) => {
    setPullRequests((previous) => ({
      ...previous,
      error: {
        type: ErrorType.Unknown,
        message: 'Unable to complete request',
        details: error instanceof Error ? error.message : String(error),
        actionText: undefined,
        actionHref: undefined,
      },
    }))
  }, [])

  useEffect(() => {
    let active = true
    let dataReceived = false
    const unsubscribe = globalThis.api.receive('pr-data', (data) => {
      dataReceived = true
      setPullRequests(data)
    })
    globalThis.api
      .invoke('get-pr-data')
      .then((data) => {
        if (active && !dataReceived && data) setPullRequests(data)
      })
      .catch((error) => {
        if (active && !dataReceived) showError(error)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [showError])

  useEffect(() => {
    let active = true
    let settingsReceived = false
    const receiveSettings = (settings: SettingsModel) => {
      setProfiles(settings.profiles)
      if (!settingsReceived) {
        setSelectedValue(settings.profiles.find((profile) => profile.isDefault)?.id ?? 'builtin:all')
      }
      settingsReceived = true
    }
    const unsubscribe = globalThis.api.receive('settings', receiveSettings)
    globalThis.api
      .invoke('get-settings')
      .then((settings) => {
        if (active && !settingsReceived) receiveSettings(settings)
      })
      .catch((error) => {
        if (active && !settingsReceived) showError(error)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [showError])

  const profileData = useMemo(
    () =>
      profiles
        .filter((profile) => profile.visible)
        .map((profile) => ({
          profile,
          filtered: FilterEvaluator.evaluate(pullRequests.items, profile.filter ?? { filters: [], op: 'AND' }),
        })),
    [pullRequests.items, profiles]
  )
  const active = profileData.find((detail) => detail.profile.id === selectedValue)
  const visible = useMemo(
    () =>
      (active?.filtered ?? []).filter((pr) => matchesPullRequestSearch(pr, searchQuery, createdBy?.id, targetBranch)),
    [active?.filtered, searchQuery, createdBy?.id, targetBranch]
  )

  if (pullRequests.error) {
    return (
      <div className="container">
        <AzureDevOpsAccessBanner access={pullRequests.access} />
        {PullRequestErrors(pullRequests.error)}
      </div>
    )
  }

  const onTabSelect = (profileId: string) => {
    if (profileId === selectedValue) return
    setOpen(false)
    setSelectedValue(profileId)
  }

  const onHeaderMenu = (target: HTMLElement) => {
    positioningRef.current?.setTarget(target)
    setOpen(true)
  }

  const onApproveClick = () => {
    globalThis.api.invoke('approve-prs', menuData).catch(showError)
    setOpen(false)
  }

  const details = profileData.map(({ profile, filtered }) => {
    const badge = <CounterBadge>{filtered.length}</CounterBadge>

    const onProfileHeaderMenu = profile.enableAcceptAll
      ? (e: React.MouseEvent<HTMLElement>) => {
          if (e.type === 'auxclick' && e.button !== 1) return
          e.preventDefault()
          setMenuData(
            profile.id === selectedValue
              ? visible
              : filtered.filter((pr) => matchesPullRequestSearch(pr, searchQuery, createdBy?.id, targetBranch))
          )
          onHeaderMenu(e.currentTarget)
        }
      : undefined

    const tab: React.ReactNode = (
      <OverflowItem key={profile.id} id={profile.id}>
        <Tab key={profile.id} value={profile.id} onAuxClick={onProfileHeaderMenu} onContextMenu={onProfileHeaderMenu}>
          {profile.label} {badge}
        </Tab>
      </OverflowItem>
    )

    const list: React.ReactNode =
      selectedValue === profile.id &&
      (hasFilters && visible.length === 0 ? (
        <ZeroData
          key={profile.id}
          primaryText="No pull requests match your filters"
          secondaryText="Try different filters or press Escape to reset them."
          imagePath={emptyImage}
        />
      ) : (
        <PrList key={profile.id} data={visible} sorting={profile.sorting} />
      ))

    return {
      profile,
      tab,
      list,
      filtered,
      visible,
    }
  })
  const authors = Array.from(new Map((active?.filtered ?? []).map((pr) => [pr.author.id, pr.author])).values())
  if (createdBy && !authors.some((author) => author.id === createdBy.id)) authors.push(createdBy)
  authors.sort((a, b) => a.label.localeCompare(b.label))
  const branches = Array.from(
    new Set(
      [...(active?.filtered ?? []).map((pr) => normalizeBranchName(pr.details.targetBranch)), targetBranch].filter(
        Boolean
      )
    )
  ).sort((a, b) => a.localeCompare(b))

  return (
    <>
      <TabHeaderMenu
        open={open}
        positioning={{ positioningRef }}
        onClick={onApproveClick}
        onOpenChange={onOpenChange}
      />
      <div className="container">
        <AzureDevOpsAccessBanner access={pullRequests.access} />
        <div className="section">
          <div className="content header pr-list-header">
            <div className="pr-profile-tabs">
              <Overflow minimumVisible={2}>
                <TabList selectedValue={selectedValue} onTabSelect={(_, d) => onTabSelect(d.value as string)}>
                  {details.map((detail) => detail.tab)}
                  <OverflowMenu profiles={details.map((x) => x.profile)} onTabSelect={onTabSelect} />
                </TabList>
              </Overflow>
            </div>
            <Tooltip
              content={filtersVisible ? 'Hide filters' : 'Show filters (Ctrl+F / Cmd+F)'}
              relationship="description"
            >
              <Button
                ref={filterButtonRef}
                appearance={hasFilters ? 'primary' : 'subtle'}
                icon={hasFilters ? <FilterFilled /> : <FilterRegular />}
                aria-label={hasFilters ? 'Filters (active)' : 'Filters'}
                aria-keyshortcuts="Control+f Meta+f"
                aria-expanded={filtersVisible}
                aria-controls="pr-filter-line"
                onClick={() => {
                  setFiltersVisible((visible) => !visible)
                  setOpen(false)
                }}
              />
            </Tooltip>
          </div>
          {filtersVisible && (
            <div id="pr-filter-line" className="content pr-filter-line" role="search" aria-label="Pull request filters">
              <Input
                ref={searchInputRef}
                value={searchQuery}
                aria-label="Search pull requests"
                size="large"
                appearance="filled-lighter"
                placeholder="Filter by keyword"
                contentAfter={
                  searchQuery ? (
                    <Button
                      appearance="transparent"
                      icon={<DismissRegular />}
                      aria-label="Clear search"
                      title="Clear search"
                      onClick={() => {
                        setSearchQuery('')
                        setOpen(false)
                        searchInputRef.current?.focus()
                      }}
                    />
                  ) : undefined
                }
                onChange={(_, data) => {
                  setOpen(false)
                  setSearchQuery(data.value)
                }}
              />
              <Dropdown
                aria-label="Created by"
                inlinePopup
                size="large"
                appearance="filled-lighter"
                placeholder="Created by"
                clearable
                clearButton={{ 'aria-label': 'Clear created by', title: 'Clear created by' }}
                selectedOptions={createdBy ? [createdBy.id] : []}
                value={createdBy?.label ?? ''}
                button={{
                  children: (
                    <span className="pr-filter-author">
                      {createdBy ? <Avatar name={createdBy.label} color="colorful" size={24} /> : <PersonRegular />}
                      <Text truncate wrap={false} title={createdBy?.label}>
                        {createdBy?.label ?? 'Created by'}
                      </Text>
                    </span>
                  ),
                }}
                onOptionSelect={(_, data) => {
                  setCreatedBy(
                    data.optionValue ? (authors.find((author) => author.id === data.optionValue) ?? null) : null
                  )
                  setOpen(false)
                }}
              >
                <Option value="">All authors</Option>
                {authors.map((author) => (
                  <Option key={author.id} value={author.id}>
                    {author.label}
                  </Option>
                ))}
              </Dropdown>
              <Dropdown
                aria-label="Target branch"
                inlinePopup
                size="large"
                appearance="filled-lighter"
                placeholder="Target branch"
                clearable
                clearButton={{ 'aria-label': 'Clear target branch', title: 'Clear target branch' }}
                selectedOptions={targetBranch ? [targetBranch] : []}
                value={targetBranch}
                button={{
                  children: (
                    <Text truncate wrap={false} title={targetBranch || undefined}>
                      {targetBranch || 'Target branch'}
                    </Text>
                  ),
                }}
                onOptionSelect={(_, data) => {
                  setTargetBranch(data.optionValue ?? '')
                  setOpen(false)
                }}
              >
                <Option value="">All target branches</Option>
                {branches.map((branch) => (
                  <Option key={branch} value={branch}>
                    {branch}
                  </Option>
                ))}
              </Dropdown>
              <Tooltip content="Clear all filters and hide filter bar" relationship="label">
                <Button
                  className="pr-filter-dismiss"
                  appearance="transparent"
                  icon={<DismissRegular />}
                  aria-label="Clear all filters and hide filter bar"
                  onClick={() => {
                    clearFilters(false)
                    setFiltersVisible(false)
                    filterButtonRef.current?.focus()
                  }}
                />
              </Tooltip>
            </div>
          )}
          <div className="content scrollable-content">{details.map((detail) => detail.list)}</div>
        </div>
      </div>
    </>
  )
}
