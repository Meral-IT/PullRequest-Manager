import { PrVote } from '@/lib/models/pr-vote'
import {
  PullRequest,
  PullRequestMergeStatus,
  PullRequestPolicyEvaluationRecord,
  PullRequestPolicyEvaluationStatus,
  Reviewer,
} from '@/lib/models/pull-request.model'
import { SettingsModel } from '@/lib/models/settings.model'
import { usePersistentState } from '@/lib/tools/persistent-state.hook'
import emptyImage from '@/resources/emptyPRList.svg'
import {
  Avatar,
  AvatarGroup,
  AvatarGroupItem,
  AvatarGroupPopover,
  Badge,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  List,
  ListItem,
  Persona,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  PresenceBadgeStatus,
  TableCellLayout,
  TableColumnDefinition,
  Text,
  Tooltip,
  createTableColumn,
  partitionAvatarGroupItems,
} from '@fluentui/react-components'
import { BotFilled, CheckmarkRegular } from '@fluentui/react-icons'
import { useEffect, useRef, useState } from 'react'
import ZeroData from '../zero-data/zero-data.component'
import './pr-list.scss'

function voteToBadge(vote: PrVote): PresenceBadgeStatus {
  switch (vote) {
    case PrVote.Approved:
      return 'available'
    case PrVote.Rejected:
      return 'busy'
    case PrVote.WaitingForAuthor:
      return 'away'
    default:
      return 'unknown'
  }
}

const columns: TableColumnDefinition<PullRequest>[] = [
  createTableColumn<PullRequest>({
    columnId: 'author',
    compare: (a, b) => {
      return a.author.label.localeCompare(b.author.label)
    },
    renderHeaderCell: () => '',
    renderCell: (item) => {
      return (
        <TableCellLayout
          media={
            item.author.isBot ? (
              <Tooltip key={item.author.id} content={item.author.label} relationship="label" withArrow>
                <Avatar icon={<BotFilled />} aria-label={item.author.label} />
              </Tooltip>
            ) : (
              <Tooltip key={item.author.id} content={item.author.label} relationship="label" withArrow>
                <Avatar aria-label={item.author.label} name={item.author.label} color="colorful" />
              </Tooltip>
            )
          }
        />
      )
    },
  }),
  createTableColumn<PullRequest>({
    columnId: 'details',
    compare: (a, b) => {
      return a.details.label.localeCompare(b.details.label)
    },
    renderHeaderCell: () => 'Details',
    renderCell: (item) => {
      const failedOrConflicted =
        item.mergeStatus === PullRequestMergeStatus.Conflicts || item.mergeStatus === PullRequestMergeStatus.Failure

      const click = () => {
        window.api.invoke('web-open-url', item.urls.web)
      }

      const draftBadge = item.isDraft ? (
        <Badge appearance="outline" style={{ marginLeft: '4px' }}>
          Draft
        </Badge>
      ) : null
      const conflictBadge = failedOrConflicted ? (
        <Badge appearance="outline" color="danger" style={{ marginLeft: '4px' }}>
          Conflicts
        </Badge>
      ) : null

      return (
        <Tooltip content={`Open PR ${item.id}`} relationship="label" withArrow>
          <TableCellLayout
            className="pr-title"
            description={`${item.details.repository}`}
            appearance="primary"
            truncate
            onClick={click}
          >
            <Text truncate>{item.details.label}</Text>
            {draftBadge}
            {conflictBadge}
          </TableCellLayout>
        </Tooltip>
      )
    },
  }),
  createTableColumn<PullRequest>({
    columnId: 'reviewers',
    compare: (a, b) => {
      return a.reviewers.length - b.reviewers.length
    },
    renderHeaderCell: () => 'Reviews',
    renderCell: (item) => {
      if (item.reviewers.length === 0) {
        return <CheckmarkRegular />
      }

      return (
        <TableCellLayout>
          <ReviewerGroup reviewers={item.reviewers} />
        </TableCellLayout>
      )
    },
  }),
  createTableColumn<PullRequest>({
    columnId: 'statusChecks',
    compare: (a, b) => {
      const aFailed = a.evaluations.filter(
        (status) => status.status === PullRequestPolicyEvaluationStatus.Rejected
      ).length
      const bFailed = b.evaluations.filter(
        (status) => status.status === PullRequestPolicyEvaluationStatus.Rejected
      ).length
      return aFailed - bFailed
    },
    renderHeaderCell: () => 'Status Checks',
    renderCell: (item) => {
      const { failedChecks, pendingChecks } = item.evaluations.reduce(
        (acc, status) => {
          if (status.status === PullRequestPolicyEvaluationStatus.Rejected) {
            acc.failedChecks.push(status)
          } else if (status.status === PullRequestPolicyEvaluationStatus.Queued) {
            acc.pendingChecks.push(status)
          }
          return acc
        },
        { failedChecks: [], pendingChecks: [] } as {
          failedChecks: PullRequestPolicyEvaluationRecord[]
          pendingChecks: PullRequestPolicyEvaluationRecord[]
        }
      )

      if (failedChecks.length === 0 && pendingChecks.length === 0) {
        return <CheckmarkRegular />
      }

      return (
        <Tooltip
          content={
            <>
              {failedChecks.length > 0 &&
                failedChecks.map((status) => <div key={status.id}>{status.displayName} failed.</div>)}
              {pendingChecks.length > 0 &&
                pendingChecks.map((status) => <div key={status.id}>{status.displayName} pending.</div>)}
            </>
          }
          relationship="label"
          withArrow
        >
          <TableCellLayout>
            {failedChecks.length > 0 && (
              <Badge appearance="outline" color="danger" style={{ marginRight: '4px' }}>
                {failedChecks.length} failed
              </Badge>
            )}
            {pendingChecks.length > 0 && (
              <Badge appearance="outline" color="brand">
                {pendingChecks.length} pending
              </Badge>
            )}
          </TableCellLayout>
        </Tooltip>
      )
    },
  }),
]

const ReviewerGroup = ({ reviewers }: { reviewers: Reviewer[] }) => {
  const sortedReviewers = reviewers.toSorted((a, b) => {
    if (a.isRequired && !b.isRequired) {
      return -1
    }
    if (!a.isRequired && b.isRequired) {
      return 1
    }
    return a.user.label.localeCompare(b.user.label)
  })
  const { inlineItems, overflowItems } = partitionAvatarGroupItems({
    items: sortedReviewers,
  })

  const getVoteDescription = (rev: Reviewer): string => {
    if (rev.vote === PrVote.NoVote) {
      return 'No review yet'
    }
    if (!rev.isRequired || rev.reviewedBy === undefined || rev.reviewedBy?.length === 0) {
      return PrVote[rev.vote]
    }
    const voters = rev.reviewedBy.filter((r) => r.vote !== PrVote.NoVote)
    if (voters.length === 0) {
      return PrVote[rev.vote]
    }
    return (
      PrVote[rev.vote] +
      ' by ' +
      rev.reviewedBy
        .filter((r) => r.vote !== PrVote.NoVote)
        .map((r) => r.user.label)
        .join(', ')
    )
  }
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <Popover
      open={open}
      onOpenChange={(e, data) => {
        if (e.target === buttonRef.current) {
          // Ignore events that are triggered by the button to avoid re-opening the popover
          return
        }

        setOpen(data.open)
      }}
    >
      <PopoverTrigger disableButtonEnhancement>
        <AvatarGroup layout="stack" size={24} onMouseOver={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
          {inlineItems.map((review) => (
            // <Tooltip key={review.user.id} content={review.user.label} relationship="label" withArrow>
            <AvatarGroupItem
              active={review.isRequired ? 'active' : undefined}
              name={review.user.label}
              key={review.user.id}
              badge={{ status: voteToBadge(review.vote) }}
            />
            // </Tooltip>
          ))}
          {overflowItems && (
            <AvatarGroupPopover>
              {overflowItems.map((review) => (
                <AvatarGroupItem name={review.user.label} key={review.user.id} />
              ))}
            </AvatarGroupPopover>
          )}
        </AvatarGroup>
      </PopoverTrigger>

      <PopoverSurface tabIndex={-1}>
        <List navigationMode="items">
          {sortedReviewers.map((rev) => (
            <ListItem key={rev.user.label} aria-label={`${rev}`}>
              <Persona
                avatar={{
                  name: rev.user.label,
                  active: rev.isRequired ? 'active' : undefined,
                  badge: { status: voteToBadge(rev.vote) },
                  color: 'colorful',
                  size: 24,
                }}
                name={rev.user.label}
                secondaryText={getVoteDescription(rev)}
                key={rev.user.id}
              ></Persona>
            </ListItem>
          ))}
        </List>
      </PopoverSurface>
    </Popover>
  )
}

const columnSizingOptions = {
  author: {
    idealWidth: 30,
  },
  details: {
    idealWidth: 1500,
  },
  reviews: {
    idealWidth: 80,
  },
  statusChecks: {
    idealWidth: 100,
  },
}

type Props = {
  data: PullRequest[]
}

export default function PrList(props: Readonly<Props>) {
  const [tableSize, setTableSize] = usePersistentState('pr-table-size', 'small')
  const { data } = props

  useEffect(() => {
    async function fetchData() {
      await window.api.invoke('get-settings').then((settings: SettingsModel) => {
        return setTableSize(settings.appearance.tableSize)
      })
    }

    fetchData()
  }, [])

  useEffect(() => {
    return window.api.receive('settings', (data: SettingsModel) => {
      return setTableSize(data.appearance.tableSize)
    })
  }, [])

  if (data.length === 0) {
    return (
      <ZeroData
        primaryText="Currently, no pull requests need your attention"
        secondaryText="Pull requests allow you to review code and help ensure quality before merge."
        imagePath={emptyImage}
      />
    )
  }

  return (
    <DataGrid
      items={data}
      columns={columns}
      columnSizingOptions={columnSizingOptions}
      // selectionMode="multiselect"
      sortable
      size={tableSize as any}
      // subtleSelection
      resizableColumns
      style={{ minWidth: '100%' }}
    >
      <DataGridHeader>
        <DataGridRow>
          {({ renderHeaderCell }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}
        </DataGridRow>
      </DataGridHeader>
      <DataGridBody<PullRequest>>
        {({ item, rowId }) => (
          <DataGridRow<PullRequest> key={rowId}>
            {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
          </DataGridRow>
        )}
      </DataGridBody>
    </DataGrid>
  )
}
