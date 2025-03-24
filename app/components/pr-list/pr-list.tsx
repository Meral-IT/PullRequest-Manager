import * as React from 'react'
import { BotFilled, ChatRegular, CheckmarkRegular } from '@fluentui/react-icons'
import {
  Avatar,
  TableColumnDefinition,
  TableCellLayout,
  createTableColumn,
  DataGrid,
  DataGridBody,
  DataGridRow,
  DataGridCell,
  DataGridProps,
  AvatarGroup,
  AvatarGroupItem,
  PresenceBadgeStatus,
  Tooltip,
  partitionAvatarGroupItems,
  AvatarGroupPopover,
  DataGridHeader,
  DataGridHeaderCell,
} from '@fluentui/react-components'
import ZeroData from '../zero-data/zero-data.component'
import emptyImage from '@/resources/emptyPRList.svg'
import { PrVote } from '@/lib/models/pr-vote'
import { PullRequest, Reviewer } from '@/lib/models/pull-request.model'

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
      return (
        <TableCellLayout
          description={`
          ${item.details.repository}`}
          appearance="primary"
        >
          {item.details.label}
        </TableCellLayout>
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
    columnId: 'comments',
    compare: (a, b) => {
      return a.interactions.activeThreads - b.interactions.activeThreads
    },
    renderHeaderCell: () => 'Comments',
    renderCell: (item) => {
      if (item.interactions.activeThreads === 0) {
        return <CheckmarkRegular />
      }

      const desc = item.interactions.activeFromBots > 0 ? `${item.interactions.activeFromBots} from bots` : ''
      return (
        <TableCellLayout description={desc} media={<ChatRegular />}>
          {item.interactions.activeThreads}
        </TableCellLayout>
      )
    },
  }),
  createTableColumn<PullRequest>({
    columnId: 'lastUpdated',
    compare: (a, b) => {
      return a.lastUpdated.timestamp - b.lastUpdated.timestamp
    },
    renderCell: (item) => {
      return item.lastUpdated.label
    },
  }),
]

const ReviewerGroup = ({ reviewers }: { reviewers: Reviewer[] }) => {
  const sortedReviewers = reviewers.sort((a, b) => {
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
  return (
    <AvatarGroup layout="stack" size={24}>
      {inlineItems.map((review) => (
        <Tooltip key={review.user.id} content={review.user.label} relationship="label" withArrow>
          <AvatarGroupItem
            active={review.isRequired ? 'active' : undefined}
            name={review.user.label}
            key={review.user.id}
            badge={{ status: voteToBadge(review.vote) }}
          />
        </Tooltip>
      ))}
      {overflowItems && (
        <AvatarGroupPopover>
          {overflowItems.map((review) => (
            <AvatarGroupItem name={review.user.label} key={review.user.id} />
          ))}
        </AvatarGroupPopover>
      )}
    </AvatarGroup>
  )
}

const columnSizingOptions = {
  author: {
    defaultWidth: 30,
    minWidth: 30,
  },
  details: {
    defaultWidth: 300,
    idealwidth: 400,
  },
  reviews: {
    defaultWidth: 20,
    idealwidth: 20,
  },
  comments: {
    defaultWidth: 20,
    idealwidth: 20,
  },
  lastUpdated: {
    defaultWidth: 20,
    idealwidth: 20,
  },
}

type Props = {
  data: PullRequest[]
}

export default function PrList(props: Props) {
  const defaultSortState = React.useMemo<Parameters<NonNullable<DataGridProps['onSortChange']>>[1]>(
    () => ({ sortColumn: 'details', sortDirection: 'ascending' }),
    []
  )

  const { data } = props

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
      defaultSortState={defaultSortState}
      columnSizingOptions={columnSizingOptions}
      selectionMode="multiselect"
      size="small"
      subtleSelection
      resizableColumns
      style={{ minWidth: '100%' }}
    >
      <DataGridHeader>
        <DataGridRow
          selectionCell={{
            checkboxIndicator: { 'aria-label': 'Select all rows' },
          }}
        >
          {({ renderHeaderCell, columnId }, dataGrid) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}
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
