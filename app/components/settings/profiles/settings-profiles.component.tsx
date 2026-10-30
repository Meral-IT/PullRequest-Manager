import { defaultProfileSorting } from '@/lib/models/pr-profile'
import {
  Body1Stronger,
  Button,
  Caption1,
  Checkbox,
  Field,
  Input,
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
import { lazy, Suspense, useContext, useState } from 'react'
import { useParams } from 'react-router-dom'
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
        onClick={() => actions.addProfile()}
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
          onClick={() => duplicateSource && actions.duplicateProfile(duplicateSource.id)}
        >
          Duplicate
        </Button>
      </div>
    </div>
  )
}

const DeleteButtonPopOverContent = () => {
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
      <Button icon={<BinRecycleRegular />} onClick={() => actions.deleteProfile(profile.id)}>
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

  const profile = state.profiles.find((p) => p.id === profileId)
  if (!profile) return <NewProfile />
  const { sorting = defaultProfileSorting } = profile

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
        <div className={styles.toolbar}>
          <div className={styles.options}>
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
          validationMessage={profile.filterValidationMessage}
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
