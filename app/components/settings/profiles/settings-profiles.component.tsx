import {
  Body1Stronger,
  Button,
  Checkbox,
  Field,
  Input,
  makeResetStyles,
  makeStyles,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Select,
  Textarea,
  Title1,
  tokens,
} from '@fluentui/react-components'
import { AddFilled, BinRecycleRegular, ClipboardPasteFilled, CopyRegular } from '@fluentui/react-icons'
import { useContext, useState } from 'react'
import { useParams } from 'react-router-dom'
import { SettingsContext } from '../context'

const useStackClassName = makeResetStyles({
  display: 'flex',
  flexDirection: 'column',
  rowGap: tokens.spacingVerticalL,
  flex: 1,
})

const useStyles = makeStyles({
  container: {
    paddingBottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  height: {
    height: '100%',
  },
  textarea: {
    maxHeight: 'unset',
    height: '100%',
    minHeight: '200px',
  },
  gap: { display: 'flex', gap: '1rem' },
  bottom: { marginTop: 'auto' },
  dangerButton: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    ':hover': {
      backgroundColor: tokens.colorStatusDangerBackground3Hover,
    },
    ':active': {
      backgroundColor: tokens.colorStatusDangerBackground3Pressed,
    },
    ':focus': {
      backgroundColor: tokens.colorStatusDangerBackground3Pressed,
    },
  },
})

function NewProfile() {
  const { state, actions } = useContext(SettingsContext)
  const [duplicateProfile, setDuplicateProfile] = useState(state.profiles.length > 0 ? state.profiles[0].id : '')

  return (
    <div className={useStackClassName()}>
      <Title1>Add new Profile</Title1>
      <Field>
        <Button appearance="primary" icon={<AddFilled />} onClick={() => actions.addProfile()}>
          New empty profile
        </Button>
      </Field>
      <Field label="Duplicate a profile">
        <Select value={duplicateProfile} onChange={(e) => setDuplicateProfile(e.target.value)}>
          {state.profiles.map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button appearance="primary" icon={<CopyRegular />} onClick={() => actions.duplicateProfile(duplicateProfile)}>
          Duplicate
        </Button>
      </Field>
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
        <Button icon={<BinRecycleRegular />} className={styles.dangerButton}>
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
  const stack = useStackClassName()
  const styles = useStyles()

  const profile = state.profiles.find((p) => p.id === profileId)
  if (!profile) {
    return (
      <>
        <NewProfile />
        <div className={styles.container}></div>
      </>
    )
  }

  return (
    <div className={styles.container}>
      <div className={stack}>
        <Title1>{profile.label}</Title1>
        <Field label="Name" hint="The profile's name">
          <Input
            name="label"
            value={profile.label}
            onChange={(e) => {
              const wrapper = {
                profileId: profile.id,
                target: {
                  name: 'label',
                  value: e.target.value,
                },
              }

              actions.onChangeHandler(wrapper)
            }}
          />
        </Field>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div>
            <Checkbox
              label="Visible"
              name="visible"
              checked={profile.visible}
              onChange={(e) => {
                const wrapper = {
                  profileId: profile.id,
                  target: {
                    name: 'visible',
                    value: e.target.checked,
                  },
                }

                actions.onChangeHandler(wrapper)
              }}
            />
          </div>
          <div>
            <Checkbox
              label="Default profile"
              name="isDefault"
              checked={profile.isDefault}
              onChange={(e) => {
                const wrapper = {
                  profileId: profile.id,
                  target: {
                    name: 'isDefault',
                    value: e.target.checked,
                  },
                }

                actions.onChangeHandler(wrapper)
              }}
            />
          </div>
        </div>
        <Field
          label={'Filter'}
          validationState="error"
          validationMessage={'Danger zone: Make sure you know what you are doing. This is a JSON object.'}
        >
          <Textarea
            className={styles.height}
            textarea={{
              className: styles.textarea,
            }}
            name="profiles"
            value={profile.filter ? JSON.stringify(profile.filter, null, 2) : ''}
            onChange={(e) => {
              let filter
              try {
                filter = JSON.parse(e.target.value)
              } catch (error) {
                console.error('Invalid JSON input:', error)
                return // Exit early to prevent further processing
              }
              const wrapper = {
                profileId: profile.id,
                target: {
                  name: 'filter',
                  value: filter,
                },
              }

              actions.onChangeHandler(wrapper)
            }}
          />
        </Field>
      </div>
      <div className={styles.bottom}>
        <div className={styles.gap}>
          <Button
            onClick={() => {
              const filter = JSON.stringify(profile.filter, null, 2)
              navigator.clipboard.writeText(filter)
            }}
            icon={<CopyRegular />}
          >
            Copy filter
          </Button>
          <Button
            onClick={() => {
              navigator.clipboard.readText().then((text) => {
                const filter = JSON.parse(text)
                const wrapper = {
                  profileId: profile.id,
                  target: {
                    name: 'filter',
                    value: filter,
                  },
                }

                actions.onChangeHandler(wrapper)
              })
            }}
            icon={<ClipboardPasteFilled />}
          >
            Paste filter
          </Button>
          <DeleteProfileButton />
        </div>
      </div>
    </div>
  )
}
