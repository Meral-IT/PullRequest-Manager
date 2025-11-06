import ErrorComponent from '@/app/components/error/error.component'
import PrList from '@/app/components/pr-list/pr-list'
import { ErrorDetail } from '@/lib/models/error-detail'
import { PullRequestData } from '@/lib/models/pr-data'
import { PrProfile } from '@/lib/models/pr-profile'
import { PullRequest } from '@/lib/models/pull-request.model'
import { FilterEvaluator } from '@/lib/models/ui-filter.model'
import type {
  MenuItemProps,
  MenuProps,
  PositioningImperativeRef,
  PositioningShorthand,
  PositioningVirtualElement,
  TabValue
} from '@fluentui/react-components'
import {
  Button,
  CounterBadge,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Overflow,
  OverflowItem,
  Tab,
  TabList,
  tokens,
  useIsOverflowItemVisible,
  useOverflowMenu,
} from '@fluentui/react-components'
import { MoreHorizontalRegular, ThumbLikeFilled } from '@fluentui/react-icons'
import { useEffect, useRef, useState } from 'react'
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
  onTabSelect?: (tabId: string) => void;
  profiles: PrProfile[];
};

/**
 * Props for an overflow menu item that only displays when the tab is not visible
 */
type OverflowMenuItemProps = {
  tab: PrProfile;

  onClick: MenuItemProps["onClick"];
};

/**
* A menu item for an overflow menu that only displays when the tab is not visible
*/
const OverflowMenuItem = (props: OverflowMenuItemProps) => {
  const { tab, onClick } = props;
  const isVisible = useIsOverflowItemVisible(tab.id);

  if (isVisible) {
    return null;
  }

  return (
    <MenuItem key={tab.id} onClick={onClick}>
      {tab.label}
    </MenuItem>
  );
};

/**
 * Styles for the overflow menu
 */
const useOverflowMenuStyles = makeStyles({
  menu: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  menuButton: {
    alignSelf: "center",
  },
});

const OverflowMenu = (props: OverflowMenuProps) => {
  const { onTabSelect, profiles } = props;
  const { ref, isOverflowing, overflowCount } =
    useOverflowMenu<HTMLButtonElement>();

  const styles = useOverflowMenuStyles();

  const onItemClick = (tabId: string) => {
    onTabSelect?.(tabId);
  };

  if (!isOverflowing) {
    return null;
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
            <OverflowMenuItem
              key={tab.id}
              tab={tab}
              onClick={() => onItemClick(tab.id)}
            />
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};

export default function PullRequestsOverview() {
  const positioningRef = useRef<PositioningImperativeRef>(null)
  const [open, setOpen] = useState(false)
  const onOpenChange: MenuProps['onOpenChange'] = (e, data) => {
    setOpen(data.open)
  }
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

  const onTabSelect = (profileId: string) => {
    setSelectedValue(profileId);
  };

  const onHeaderAuxClick = (e: { target: (HTMLElement | PositioningVirtualElement) | null }) => {
    positioningRef.current?.setTarget(e.target)
    setOpen(!open)
  }

  const onApproveClick = () => {
    window.api.invoke('approve-prs', menuData)
    setOpen(false)
  }

  const details = profiles
    .filter((x) => x.visible)
    .map((profile) => {
      const filtered = FilterEvaluator.evaluate(pullRequests.items, profile.filter ?? { filters: [], op: 'AND' })
      const badge = <CounterBadge>{filtered.length}</CounterBadge>

      const onProfileHeaderAuxClick = profile.enableAcceptAll
        ? (e) => {
          setMenuData(filtered)
          onHeaderAuxClick(e)
        }
        : undefined

      const tab: React.ReactNode = (
        <OverflowItem key={profile.id} id={profile.id}>
          <Tab key={profile.id} value={profile.id} onAuxClick={onProfileHeaderAuxClick}>
            {profile.label} {badge}
          </Tab>
        </OverflowItem>
      )

      const list: React.ReactNode = selectedValue === profile.id && <PrList key={profile.id} data={filtered} />

      return {
        profile,
        tab,
        list,
      }
    })

  return (
    <>
      <TabHeaderMenu
        open={open}
        positioning={{ positioningRef }}
        onClick={onApproveClick}
        onOpenChange={onOpenChange}
      />
      <div className="container">
        <div className="section">
          <div className="content header">
            <Overflow minimumVisible={2}>
              <TabList selectedValue={selectedValue} onTabSelect={(_, d) => onTabSelect(d.value as string)}>
                {details.map((detail) => detail.tab)}
                <OverflowMenu profiles={details.map(x => x.profile)} onTabSelect={onTabSelect} />
              </TabList>
            </Overflow>
          </div>
          <div className="content scrollable-content">{details.map((detail) => detail.list)}</div>
        </div>
      </div>
    </>
  )
}
