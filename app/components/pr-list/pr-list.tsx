import { defaultProfileSorting, PrProfile } from '@/lib/models/pr-profile'
import { PrVote } from '@/lib/models/pr-vote'
import {
  PullRequest,
  pullRequestKey,
  PullRequestMergeStatus,
  PullRequestPolicyEvaluationStatus,
  Reviewer,
} from '@/lib/models/pull-request.model'
import { SettingsModel } from '@/lib/models/settings.model'
import { normalizeBranchName } from '@/lib/tools/name-normalizer'
import { pullRequestDescriptionContext } from '@/lib/tools/pr-search'
import { usePersistentState } from '@/lib/tools/persistent-state.hook'
import emptyImage from '@/resources/emptyPRList.svg'
import {
  Avatar,
  AvatarGroup,
  AvatarGroupItem,
  AvatarGroupPopover,
  Badge,
  Button,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridCellFocusMode,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  DataGridProps,
  Link,
  List,
  ListItem,
  MessageBar,
  MessageBarBody,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Persona,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  PositioningImperativeRef,
  PositioningVirtualElement,
  PresenceBadgeStatus,
  TableCellLayout,
  TableColumnDefinition,
  Text,
  Tooltip,
  createTableColumn,
  partitionAvatarGroupItems,
} from '@fluentui/react-components'
import { BotFilled, CheckmarkRegular, MoreVerticalRegular } from '@fluentui/react-icons'
import { MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ZeroData from '../zero-data/zero-data.component'
import './pr-list.scss'
import { usePrVoteAction } from './use-pr-vote-action'

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

const policyOutcomes = {
  [PullRequestPolicyEvaluationStatus.Queued]: 'pending',
  [PullRequestPolicyEvaluationStatus.Running]: 'pending',
  [PullRequestPolicyEvaluationStatus.Approved]: 'approved',
  [PullRequestPolicyEvaluationStatus.Rejected]: 'failed',
  [PullRequestPolicyEvaluationStatus.NotApplicable]: 'not applicable',
  [PullRequestPolicyEvaluationStatus.Broken]: 'failed',
} as const

const createColumns = (
  reportActionError: (error: unknown) => void,
  openActions: (event: ReactMouseEvent<HTMLElement>, pr: PullRequest) => void,
  openPr: PullRequest | null,
  searchQuery: string
): TableColumnDefinition<PullRequest>[] => [
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

      const click = (event: ReactMouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        return globalThis.api.invoke('web-open-url', item.urls.web).catch(reportActionError)
      }

      const sourceBranch = normalizeBranchName(item.details.branch)
      const targetBranch = normalizeBranchName(item.details.targetBranch)
      const source = [item.details.organization, item.details.project].filter(Boolean).join('/')
      const description = [source, `#${item.details.number}`, item.details.repository, `${sourceBranch} → ${targetBranch}`]
        .filter(Boolean)
        .join(' · ')

      const context = pullRequestDescriptionContext(item, searchQuery)

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
        <Tooltip
          content={`${item.details.label} — ${description}${context ? ` — Description: ${context}` : ''}`}
          relationship="description"
          withArrow
        >
          <TableCellLayout
            className="pr-title"
            description={
              context ? (
                <>
                  {description}
                  <Text block className="pr-description-match">Description: {context}</Text>
                </>
              ) : description
            }
            appearance="primary"
            truncate
          >
            <Link href={item.urls.web} onClick={click}>
              <Text truncate>{item.details.label}</Text>
            </Link>
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
        return <TableCellLayout>No reviewers</TableCellLayout>
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
      const aFailed = a.evaluations.filter((status) => policyOutcomes[status.status] === 'failed').length
      const bFailed = b.evaluations.filter((status) => policyOutcomes[status.status] === 'failed').length
      return aFailed - bFailed
    },
    renderHeaderCell: () => 'Status Checks',
    renderCell: (item) => {
      if (item.evaluations.length === 0) {
        return <TableCellLayout>No checks</TableCellLayout>
      }

      const counts = { failed: 0, pending: 0, approved: 0, 'not applicable': 0 }
      for (const evaluation of item.evaluations) {
        counts[policyOutcomes[evaluation.status]]++
      }
      const summary = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([outcome, count]) => `${count} ${outcome}`)
        .join(', ')

      return (
        <Tooltip
          content={
            <>
              {item.evaluations.map((evaluation) => (
                <div key={evaluation.id}>
                  {evaluation.displayName}:{' '}
                  {evaluation.status === PullRequestPolicyEvaluationStatus.NotApplicable
                    ? 'Not applicable'
                    : PullRequestPolicyEvaluationStatus[evaluation.status]}
                  .
                </div>
              ))}
            </>
          }
          relationship="description"
          withArrow
        >
          <TableCellLayout role="img" aria-label={summary} tabIndex={0}>
            {counts.failed > 0 && (
              <Badge appearance="outline" color="danger" style={{ marginRight: '4px' }}>
                {counts.failed} failed
              </Badge>
            )}
            {counts.pending > 0 && (
              <Badge appearance="outline" color="brand" style={{ marginRight: '4px' }}>
                {counts.pending} pending
              </Badge>
            )}
            {counts.failed === 0 && counts.pending === 0 && (
              <>
                {counts.approved > 0 && <CheckmarkRegular />}
                {counts['not applicable'] > 0 && (
                  <Badge appearance="outline" color="subtle">
                    {counts['not applicable']} N/A
                  </Badge>
                )}
              </>
            )}
          </TableCellLayout>
        </Tooltip>
      )
    },
  }),
  createTableColumn<PullRequest>({
    columnId: 'actions',
    renderHeaderCell: () => 'Actions',
    renderCell: (item) => (
      <Tooltip content="More options" relationship="description">
        <Button
          appearance="subtle"
          size="small"
          icon={<MoreVerticalRegular />}
          aria-label={`Actions for PR ${item.id}: ${item.details.label}`}
          aria-haspopup="menu"
          aria-expanded={openPr === item}
          onClick={(event) => openActions(event, item)}
        />
      </Tooltip>
    ),
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
            <ListItem key={rev.user.id} aria-label={rev.user.label}>
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
  actions: {
    idealWidth: 100,
    minWidth: 100,
  },
}

type Props = {
  data: PullRequest[]
  sorting?: PrProfile['sorting']
  searchQuery?: string
  voteAction?: ReturnType<typeof usePrVoteAction>
}

export default function PrList(props: Readonly<Props>) {
  const localVoteAction = usePrVoteAction()
  const voteAction = props.voteAction ?? localVoteAction
  const [page, setPage] = useState(0)
  const [manualSort, setManualSort] = useState<NonNullable<DataGridProps['sortState']>>({
    sortColumn: undefined,
    sortDirection: 'ascending',
  })
  const [tableSize, setTableSize] = usePersistentState('pr-table-size', 'small')
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPr, setContextMenuPr] = useState<PullRequest | null>(null)
  const [vscodeInstalled, setVscodeInstalled] = useState(false)
  const [solutionFiles, setSolutionFiles] = useState<string[]>([])
  const [actionError, setActionError] = useState('')
  const positioningRef = useRef<PositioningImperativeRef>(null)
  const actionTriggerRef = useRef<HTMLElement | null>(null)
  const contextMenuRepositoryRef = useRef<string | null>(null)
  const { data, sorting = defaultProfileSorting, searchQuery = '' } = props
  const { sortColumn, sortDirection } = sorting ?? manualSort
  const currentPage = Math.min(page, Math.max(0, Math.ceil(data.length / 100) - 1))

  useEffect(() => {
    setPage(0)
  }, [data, sortColumn, sortDirection])

  useEffect(() => {
    setContextMenuOpen(false)
    contextMenuRepositoryRef.current = null
    return () => {
      contextMenuRepositoryRef.current = null
    }
  }, [data, currentPage, sortColumn, sortDirection])

  useEffect(() => {
    let active = true
    let settingsReceived = false
    const unsubscribe = globalThis.api.receive('settings', (data: SettingsModel) => {
      settingsReceived = true
      setTableSize(data.appearance.tableSize)
    })
    globalThis.api
      .invoke('get-settings')
      .then((settings: SettingsModel) => {
        if (active && !settingsReceived) setTableSize(settings.appearance.tableSize)
      })
      .catch((error) => console.error('Unable to load table settings', error))
    return () => {
      active = false
      unsubscribe()
    }
  }, [setTableSize])

  useEffect(() => {
    let active = true
    globalThis.api
      .invoke('check-vscode-installed')
      .then((isInstalled: boolean) => {
        if (active) setVscodeInstalled(isInstalled)
      })
      .catch((error) => console.error('Unable to check VSCode installation', error))
    return () => {
      active = false
    }
  }, [])

  const reportActionError = useCallback((error: unknown) => {
    setActionError(error instanceof Error ? error.message : 'Unable to complete request. Please try again.')
  }, [])

  const closeContextMenu = (restoreFocus = true) => {
    setContextMenuOpen(false)
    contextMenuRepositoryRef.current = null
    if (restoreFocus) actionTriggerRef.current?.focus()
  }

  const openContextMenu = useCallback(
    async (e: ReactMouseEvent<HTMLElement>, pr: PullRequest, atPointer = false) => {
      e.preventDefault()
      const target: PositioningVirtualElement = {
        getBoundingClientRect: () => new DOMRect(e.clientX, e.clientY, 0, 0),
      }
      positioningRef.current?.setTarget(atPointer && (e.clientX || e.clientY) ? target : e.currentTarget)
      actionTriggerRef.current = atPointer
        ? ((e.target as Element).closest<HTMLElement>('a, button, [tabindex]') ?? e.currentTarget)
        : e.currentTarget
      setContextMenuPr(pr)
      setSolutionFiles([])
      setContextMenuOpen(true)

      const requestedRepository = pr.details.repository
      contextMenuRepositoryRef.current = requestedRepository

      try {
        const files = await globalThis.api.invoke('find-solution-files', requestedRepository)
        if (contextMenuRepositoryRef.current === requestedRepository) {
          setSolutionFiles(Array.isArray(files) ? files : [])
        }
      } catch (error) {
        if (contextMenuRepositoryRef.current === requestedRepository) reportActionError(error)
      }
    },
    [reportActionError]
  )

  const columns = useMemo(
    () => createColumns(reportActionError, openContextMenu, contextMenuOpen ? contextMenuPr : null, searchQuery),
    [reportActionError, openContextMenu, contextMenuOpen, contextMenuPr, searchQuery]
  )
  const items = useMemo(() => {
    const compare =
      sortColumn === 'creationDate'
        ? (a: PullRequest, b: PullRequest) => (a.creationDate?.getTime() ?? 0) - (b.creationDate?.getTime() ?? 0)
        : columns.find((column) => column.columnId === sortColumn)?.compare
    return compare ? data.toSorted((a, b) => compare(a, b) * (sortDirection === 'ascending' ? 1 : -1)) : data
  }, [data, sortColumn, sortDirection, columns])
  const pageItems = useMemo(() => items.slice(currentPage * 100, (currentPage + 1) * 100), [items, currentPage])

  const approveCurrentPullRequest = () => {
    if (!contextMenuPr) {
      return
    }
    void voteAction.run('approve', [contextMenuPr])
    closeContextMenu()
  }

  const resetCurrentPullRequestFeedback = () => {
    if (!contextMenuPr) {
      return
    }
    void voteAction.run('reset', [contextMenuPr])
    closeContextMenu()
  }

  const openCurrentRepositoryInVsCode = () => {
    if (!contextMenuPr) {
      return
    }
    globalThis.api.invoke('open-in-vscode', contextMenuPr.details.repository).catch(reportActionError)
    closeContextMenu()
  }

  const openSolutionFile = (solutionFilePath: string) => {
    globalThis.api.invoke('open-solution-file', solutionFilePath).catch(reportActionError)
    closeContextMenu()
  }

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
    <>
      {!props.voteAction && voteAction.pending && (
        <MessageBar role="status">
          <MessageBarBody>Updating pull request votes…</MessageBarBody>
        </MessageBar>
      )}
      {!props.voteAction && voteAction.notice && (
        <MessageBar intent={voteAction.notice.intent} role={voteAction.notice.intent === 'error' ? 'alert' : 'status'}>
          <MessageBarBody>{voteAction.notice.message}</MessageBarBody>
        </MessageBar>
      )}
      {actionError && (
        <MessageBar intent="error" role="alert">
          <MessageBarBody>{actionError}</MessageBarBody>
        </MessageBar>
      )}
      <Menu
        open={contextMenuOpen}
        positioning={{ positioningRef }}
        onOpenChange={(_, event) => {
          if (event.open) setContextMenuOpen(true)
          else closeContextMenu(event.type === 'menuPopoverKeyDown')
        }}
      >
        <MenuPopover>
          <MenuList>
            <MenuItem disabled={voteAction.pending} onClick={approveCurrentPullRequest}>
              Approve
            </MenuItem>
            <MenuItem disabled={voteAction.pending} onClick={resetCurrentPullRequestFeedback}>
              Reset feedback
            </MenuItem>
            <MenuDivider />
            {vscodeInstalled && <MenuItem onClick={openCurrentRepositoryInVsCode}>Open in VSCode</MenuItem>}
            {solutionFiles.length === 1 && (
              <MenuItem onClick={() => openSolutionFile(solutionFiles[0])}>Open in VisualStudio</MenuItem>
            )}
            {solutionFiles.length > 1 && (
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>Open in VisualStudio</MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {solutionFiles.map((solutionFile) => (
                      <MenuItem key={solutionFile} onClick={() => openSolutionFile(solutionFile)}>
                        {solutionFile.split(/[/\\]/).pop()}
                      </MenuItem>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      {items.length > 100 && (
        <nav className="pr-pagination" aria-label="Pull request pages">
          <Text role="status" aria-live="polite" aria-atomic="true">
            {`${currentPage * 100 + 1}–${Math.min((currentPage + 1) * 100, items.length)} of ${items.length} PRs`}
          </Text>
          <Button
            size="small"
            aria-label="Previous PR page"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          <Button
            size="small"
            aria-label="Next PR page"
            disabled={(currentPage + 1) * 100 >= items.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </nav>
      )}
      <DataGrid
        items={pageItems}
        getRowId={pullRequestKey}
        columns={columns}
        columnSizingOptions={columnSizingOptions}
        // selectionMode="multiselect"
        sortable={!sorting}
        sortState={sorting ?? manualSort}
        onSortChange={(_, state) => setManualSort(state)}
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
            <DataGridRow<PullRequest> key={rowId} onContextMenu={(e) => openContextMenu(e, item, true)}>
              {({ renderCell, columnId }) => {
                let focusMode: DataGridCellFocusMode = 'cell'
                if (columnId === 'actions') {
                  focusMode = 'none'
                } else if (columnId === 'details' || columnId === 'statusChecks') {
                  focusMode = 'group'
                }
                return <DataGridCell focusMode={focusMode}>{renderCell(item)}</DataGridCell>
              }}
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
    </>
  )
}
