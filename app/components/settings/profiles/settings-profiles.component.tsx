import type { PullRequestData } from '@/lib/models/pr-data'
import { FilterEvaluator } from '@/lib/models/ui-filter.model'
import { defaultProfileSorting } from '@/lib/models/pr-profile'
import {
  Body1Stronger,
  Button,
  Caption1,
  Checkbox,
  Field,
  Input,
  Link,
  makeStyles,
  mergeClasses,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Select,
  Spinner,
  Tab,
  TabList,
  Title1,
  tokens,
} from '@fluentui/react-components'
import { AddFilled, BinRecycleRegular, ClipboardPasteFilled, CopyRegular } from '@fluentui/react-icons'
import { lazy, Suspense, useContext, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SettingsContext } from '../context'

const FilterEditor = lazy(() => import('./filter-editor.component'))

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 0,
  },
  profileContainer: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    flex: '1 1 0px',
    minHeight: 0,
    minWidth: 0,
  },
  heading: {
    margin: 0,
    flexShrink: 0,
    '@media (max-height: 550px)': {
      fontSize: tokens.fontSizeBase500,
      lineHeight: tokens.lineHeightBase500,
    },
  },
  tabs: { flexShrink: 0 },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    flex: '1 1 0px',
    minHeight: 0,
    minWidth: 0,
    overflowY: 'auto',
    '&[hidden]': { display: 'none' },
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    minWidth: 0,
  },
  options: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalXS,
  },
  behavior: { border: 0, padding: 0, margin: 0 },
  sortRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    alignItems: 'start',
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalS,
    '@media (max-width: 700px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  hint: { color: tokens.colorNeutralForeground2 },
  filterPanel: { rowGap: tokens.spacingVerticalS },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
  },
  editor: {
    minHeight: '180px',
    minWidth: 0,
    flexBasis: '180px',
    flexGrow: 1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    '@media (max-height: 550px)': {
      minHeight: '80px',
      flexBasis: '80px',
    },
  },
  editorField: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  duplicateRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'end',
    gap: tokens.spacingHorizontalS,
    '@media (max-width: 700px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      justifyItems: 'start',
    },
  },
  fullWidth: { width: '100%', minWidth: 0 },
  createButton: { alignSelf: 'flex-start' },
  dangerActions: {
    marginTop: 'auto',
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  dangerButton: {
    color: tokens.colorStatusDangerForeground2,
    ':hover': {
      color: tokens.colorStatusDangerForeground2,
      backgroundColor: tokens.colorStatusDangerBackground1,
    },
    ':active': {
      color: tokens.colorStatusDangerForeground2,
      backgroundColor: tokens.colorStatusDangerBackground2,
    },
  },
})

function NewProfile() {
  const navigate = useNavigate()
  const { state, actions } = useContext(SettingsContext)
  const styles = useStyles()
  const [duplicateProfile, setDuplicateProfile] = useState(state.profiles.length > 0 ? state.profiles[0].id : '')
  const duplicateSource = state.profiles.find((profile) => profile.id === duplicateProfile) ?? state.profiles[0]

  return (
    <div className={styles.container}>
      <Title1 as="h1" className={styles.heading}>
        Add new profile
      </Title1>
      <Button
        className={styles.createButton}
        appearance="primary"
        icon={<AddFilled />}
        onClick={() => navigate(`/settings/profiles/${actions.addProfile()}`)}
      >
        New empty profile
      </Button>
      <div className={styles.duplicateRow}>
        <Field label="Duplicate a profile" className={styles.fullWidth}>
          <Select
            className={styles.fullWidth}
            disabled={state.profiles.length === 0}
            value={duplicateSource?.id ?? ''}
            onChange={(e) => setDuplicateProfile(e.target.value)}
          >
            {state.profiles.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          disabled={!duplicateSource}
          icon={<CopyRegular />}
          onClick={() => {
            if (!duplicateSource) return
            const id = actions.duplicateProfile(duplicateSource.id)
            if (id) navigate(`/settings/profiles/${id}`)
          }}
        >
          Duplicate
        </Button>
      </div>
    </div>
  )
}

const DeleteButtonPopOverContent = () => {
  const navigate = useNavigate()
  const { profileId } = useParams()
  const { state, actions } = useContext(SettingsContext)

  const profile = state.profiles.find((p) => p.id === profileId)
  if (!profile) {
    return <div>Profile not found</div>
  }

  return (
    <div>
      <Body1Stronger>Do you really want to delete this profile?</Body1Stronger>
      <br />
      <Button
        icon={<BinRecycleRegular />}
        onClick={() => {
          actions.deleteProfile(profile.id)
          const remaining = state.profiles.find((item) => item.id !== profile.id)
          navigate(`/settings/profiles/${remaining?.id ?? 'new'}`)
        }}
      >
        Yes, delete profile
      </Button>
    </div>
  )
}

const DeleteProfileButton = () => {
  const styles = useStyles()

  return (
    <Popover>
      <PopoverTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<BinRecycleRegular />} className={styles.dangerButton}>
          Delete profile
        </Button>
      </PopoverTrigger>
      <PopoverSurface tabIndex={-1}>
        <DeleteButtonPopOverContent />
      </PopoverSurface>
    </Popover>
  )
}

export default function ProfileSettings() {
  const { profileId } = useParams()
  const { state, actions } = useContext(SettingsContext)
  const styles = useStyles()
  const [selectedTab, setSelectedTab] = useState<'general' | 'filter'>('general')
  const [clipboardError, setClipboardError] = useState('')
  const [previewData, setPreviewData] = useState<(PullRequestData & { isLoading?: boolean }) | null>()

  useEffect(() => {
    let active = true
    let dataReceived = false
    const unsubscribe = globalThis.api.receive('pr-data', (data: PullRequestData) => {
      dataReceived = true
      if (active) setPreviewData(data ?? null)
    })
    globalThis.api
      .invoke('get-pr-data')
      .then((data: PullRequestData | undefined) => {
        if (active && !dataReceived) setPreviewData(data ?? null)
      })
      .catch(() => {
        if (active && !dataReceived) setPreviewData(null)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const profile = state.profiles.find((p) => p.id === profileId)
  if (!profile) return <NewProfile />
  const { sorting = defaultProfileSorting } = profile
  const previewMessage =
    previewData === undefined || previewData?.isLoading
      ? 'Loading PR preview…'
      : !previewData || previewData.error || previewData.integrations?.some((item) => item.error)
        ? 'Preview unavailable: PR data could not be loaded.'
        : `Matches ${FilterEvaluator.evaluate(previewData.items, profile.filter ?? '').length} currently loaded PRs.`

  return (
    <div className={styles.profileContainer}>
      <Title1 as="h1" className={styles.heading}>
        Profile settings
      </Title1>
      <TabList
        className={styles.tabs}
        aria-label="Profile sections"
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as 'general' | 'filter')}
      >
        <Tab id="profile-general-tab" value="general" aria-controls="profile-general-panel">
          General
        </Tab>
        <Tab id="profile-filter-tab" value="filter" aria-controls="profile-filter-panel">
          {profile.filterValid ? 'Filter' : 'Filter (invalid)'}
        </Tab>
      </TabList>
      <div
        id="profile-general-panel"
        role="tabpanel"
        aria-labelledby="profile-general-tab"
        hidden={selectedTab !== 'general'}
        className={styles.panel}
        tabIndex={0}
      >
        <section className={styles.section} aria-label="Profile details">
          <Field label="Name">
            <Input
              className={styles.fullWidth}
              name="label"
              value={profile.label}
              onChange={(e) =>
                actions.onChangeHandler({
                  profileId: profile.id,
                  target: { name: 'label', value: e.target.value },
                })
              }
            />
          </Field>
          <fieldset className={mergeClasses(styles.options, styles.behavior)} aria-label="Profile behavior">
            <Checkbox
              label="Show in profile tabs"
              name="visible"
              checked={profile.visible}
              onChange={(e) =>
                actions.onChangeHandler({
                  profileId: profile.id,
                  target: { name: 'visible', value: e.target.checked },
                })
              }
            />
            <Checkbox
              label="Default profile"
              name="isDefault"
              checked={profile.isDefault}
              onChange={(e) =>
                actions.onChangeHandler({
                  profileId: profile.id,
                  target: { name: 'isDefault', value: e.target.checked },
                })
              }
            />
            <Checkbox
              label="Notify on new PRs"
              name="notifyOnNewPrs"
              checked={profile.notifyOnNewPrs}
              onChange={(e) =>
                actions.onChangeHandler({
                  profileId: profile.id,
                  target: { name: 'notifyOnNewPrs', value: e.target.checked },
                })
              }
            />
          </fieldset>
        </section>
        <section className={styles.section} aria-label="Sorting">
          <div className={styles.sortRow}>
            <Field label="Sort by" className={styles.fullWidth}>
              <Select
                className={styles.fullWidth}
                aria-describedby="profile-sort-hint"
                value={sorting?.sortColumn ?? ''}
                onChange={(e) =>
                  actions.onChangeHandler({
                    profileId: profile.id,
                    target: {
                      name: 'sorting',
                      value: e.target.value
                        ? {
                            sortColumn: e.target.value,
                            sortDirection: sorting?.sortDirection ?? defaultProfileSorting.sortDirection,
                          }
                        : null,
                    },
                  })
                }
              >
                <option value="">None (allow manual sorting)</option>
                <option value="author">Author</option>
                <option value="details">PR title</option>
                <option value="creationDate">PR creation date</option>
                <option value="reviewers">Reviewer count</option>
                <option value="statusChecks">Failed status checks</option>
              </Select>
            </Field>
            <Field label="Sort direction" className={styles.fullWidth}>
              <Select
                className={styles.fullWidth}
                aria-describedby="profile-sort-hint"
                disabled={!sorting}
                value={sorting?.sortDirection ?? defaultProfileSorting.sortDirection}
                onChange={(e) =>
                  actions.onChangeHandler({
                    profileId: profile.id,
                    target: {
                      name: 'sorting',
                      value: sorting && { ...sorting, sortDirection: e.target.value },
                    },
                  })
                }
              >
                <option value="ascending">Ascending</option>
                <option value="descending">Descending</option>
              </Select>
            </Field>
          </div>
          <Caption1 id="profile-sort-hint" className={styles.hint}>
            A profile sort disables sorting from column headers.
          </Caption1>
        </section>
        <div className={styles.dangerActions}>
          <DeleteProfileButton />
        </div>
      </div>
      <div
        id="profile-filter-panel"
        role="tabpanel"
        aria-labelledby="profile-filter-tab"
        hidden={selectedTab !== 'filter'}
        className={mergeClasses(styles.panel, styles.filterPanel)}
        tabIndex={0}
      >
        <Caption1 id="profile-filter-help" className={styles.hint}>
          Leave the filter blank to include all pull requests. Empty the editor to insert a non-draft PR example.
        </Caption1>
        <div className={styles.toolbar}>
          <div className={styles.options}>
            <Link
              href="https://github.com/Meral-IT/PullRequest-Manager/blob/develop/README.md#profile-filters"
              target="_blank"
              rel="noreferrer"
            >
              Filter documentation
            </Link>
            <Button
              size="small"
              appearance="subtle"
              aria-describedby="profile-filter-help"
              disabled={Boolean(profile.filter?.trim())}
              onClick={() => {
                if (profile.filter?.trim()) return
                actions.onChangeHandler({
                  profileId: profile.id,
                  target: {
                    name: 'filter',
                    value: JSON.stringify({ op: 'AND', filters: [{ isDraft: false }] }, null, 2),
                  },
                })
              }}
            >
              Insert example
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={async () => {
                setClipboardError('')
                try {
                  await navigator.clipboard.writeText(profile.filter ?? '')
                } catch {
                  setClipboardError('Unable to copy filter. Check clipboard access and try again.')
                }
              }}
              icon={<CopyRegular />}
            >
              Copy filter
            </Button>
            <Button
              size="small"
              appearance="subtle"
              onClick={async () => {
                setClipboardError('')
                try {
                  const text = await navigator.clipboard.readText()
                  actions.onChangeHandler({ profileId: profile.id, target: { name: 'filter', value: text } })
                } catch {
                  setClipboardError('Unable to paste filter. Check clipboard access and try again.')
                }
              }}
              icon={<ClipboardPasteFilled />}
            >
              Paste filter
            </Button>
          </div>
        </div>
        {clipboardError && <span role="alert">{clipboardError}</span>}
        <Field
          validationState={profile.filterValid ? 'success' : 'error'}
          validationMessage={{
            role: profile.filterValid ? 'status' : 'alert',
            children: profile.filterValid
              ? `${profile.filter?.trim() ? 'Filter is valid. ' : ''}${previewMessage}`
              : profile.filterValidationMessage,
          }}
          className={styles.editorField}
        >
          <Suspense fallback={<Spinner label="Loading filter editor" />}>
            <FilterEditor
              key={profile.id}
              className={styles.editor}
              profileId={profile.id}
              theme={state.appearanceTheme}
              value={profile.filter ?? ''}
              onChange={(value) =>
                actions.onChangeHandler({
                  profileId: profile.id,
                  target: { name: 'filter', value },
                })
              }
            />
          </Suspense>
        </Field>
      </div>
    </div>
  )
}
