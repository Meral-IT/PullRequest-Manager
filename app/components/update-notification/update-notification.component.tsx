import type { UpdateState } from '@/lib/models/update-state'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  ProgressBar,
  Text,
  Toast,
  ToastBody,
  Toaster,
  ToastFooter,
  ToastTitle,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components'
import {
  ArrowDownloadRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  DismissRegular,
  ErrorCircleRegular,
} from '@fluentui/react-icons'
import DomPurify from 'dompurify'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { getDownloadProgress } from './update-progress'
import './update-notification.component.scss'

function UpdateNotification() {
  const toastId = useId('app-update')
  const toasterId = useId('toaster')
  const [isReleaseNotesDialogOpened, setIsReleaseNotesDialogOpened] = useState(false)
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  const notification = useRef({ visible: false, id: toastId, generation: 0 })
  const actionPending = useRef(false)
  const { dispatchToast, dismissToast, updateToast } = useToastController(toasterId)
  const releaseNotes = state.status === 'idle' ? undefined : state.info
  const progress = getDownloadProgress(state.status === 'downloading' ? state.progress : undefined)
  const busy = state.status === 'downloading' || state.status === 'installing'
  const install =
    state.status === 'ready' ||
    state.status === 'installing' ||
    (state.status === 'error' && state.operation === 'install')
  const title =
    state.status === 'available'
      ? 'Update available'
      : state.status === 'ready'
        ? 'Ready to install'
        : state.status === 'installing'
          ? 'Installing update…'
          : state.status === 'error'
            ? install
              ? 'Couldn’t install update'
              : 'Couldn’t download update'
            : state.status === 'downloading'
              ? !state.progress
                ? 'Preparing download…'
                : progress.finishing
                  ? 'Finishing download…'
                  : 'Downloading update'
              : ''
  const actionLabel =
    state.status === 'error'
      ? install
        ? 'Retry installation'
        : 'Retry download'
      : state.status === 'installing'
        ? 'Installing…'
        : state.status === 'downloading'
          ? 'Downloading…'
          : install
            ? 'Restart & update'
            : 'Download update'

  const dismissAvailableUpdate = () => {
    setDismissed(true)
    notification.current.visible = false
    dismissToast(notification.current.id)
  }

  const runAction = async () => {
    if (state.status === 'idle' || busy || actionPending.current) return
    actionPending.current = true
    const operation = install ? 'install' : 'download'
    setIsReleaseNotesDialogOpened(false)
    setDismissed(false)
    setState({ status: install ? 'installing' : 'downloading', info: state.info })
    try {
      await globalThis.api.invoke(install ? 'update:install-update' : 'update:download-update')
    } catch {
      setState((current) =>
        current.status === 'downloading' || current.status === 'installing'
          ? { status: 'error', info: current.info, operation }
          : current
      )
    } finally {
      actionPending.current = false
    }
  }

  const syncNotification = useEffectEvent(() => {
    if (state.status === 'idle') {
      notification.current.visible = false
      dismissToast(notification.current.id)
      return
    }
    if (dismissed) return
    const content = (
      <Toast className="update-notification" data-update-state={state.status}>
        <ToastTitle
          media={
            state.status === 'error' ? (
              <ErrorCircleRegular />
            ) : state.status === 'ready' ? (
              <CheckmarkCircleRegular />
            ) : install ? (
              <ArrowSyncRegular />
            ) : (
              <ArrowDownloadRegular />
            )
          }
          action={
            state.status === 'available' ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<DismissRegular />}
                aria-label="Dismiss update notification"
                onClick={dismissAvailableUpdate}
              />
            ) : undefined
          }
        >
          {title}
        </ToastTitle>
        <ToastBody className="update-notification-body">
          <Text className="update-version">Version {state.info.version}</Text>
          {state.status === 'downloading' && (
            <>
              <div className="update-progress-heading">
                <Text>{progress.size ?? 'Connecting to the update server…'}</Text>
                {progress.percent !== undefined && <Text weight="semibold">{Math.floor(progress.percent)}%</Text>}
              </div>
              <ProgressBar aria-label="Update download progress" value={progress.percent} max={100} thickness="large" />
              {(progress.speed || progress.remaining) && (
                <div className="update-transfer-details">
                  <Text>{progress.speed}</Text>
                  <Text>{progress.remaining}</Text>
                </div>
              )}
            </>
          )}
          <Text className="update-description">
            {state.status === 'available'
              ? 'Download now, then restart when you’re ready.'
              : state.status === 'ready'
                ? 'Your update is downloaded. Restart to install it.'
                : state.status === 'installing'
                  ? 'The app will restart when installation is complete.'
                  : state.status === 'error'
                    ? install
                      ? 'The downloaded update is still available. Try installing it again.'
                      : 'The update couldn’t be downloaded. Please try again.'
                    : 'You can keep working. The app won’t restart until you choose.'}
          </Text>
        </ToastBody>
        <ToastFooter className="update-notification-actions">
          <Button appearance="primary" disabled={busy} onClick={runAction}>
            {actionLabel}
          </Button>
          <Button id="release-notes-button" disabled={busy} onClick={() => setIsReleaseNotesDialogOpened(true)}>
            Release notes
          </Button>
        </ToastFooter>
      </Toast>
    )
    if (!notification.current.visible) notification.current.id = `${toastId}-${++notification.current.generation}`
    const options = {
      toastId: notification.current.id,
      timeout: -1,
      onStatusChange: (_event: unknown, data: { status: string }) => {
        if (data.status === 'dismissed') {
          notification.current.visible = false
          setDismissed(true)
        }
      },
      intent:
        state.status === 'error'
          ? ('error' as const)
          : state.status === 'ready'
            ? ('success' as const)
            : ('info' as const),
    }
    if (notification.current.visible) updateToast({ ...options, content })
    else {
      notification.current.visible = true
      dispatchToast(content, options)
    }
  })

  useEffect(() => {
    syncNotification()
  }, [state, dismissed])

  const dismissNotification = useEffectEvent(() => dismissToast(notification.current.id))

  const releaseNotesItem = (version: string, note?: string | null) => {
    if (!note) return null
    return (
      <div key={version}>
        <h2>
          <span style={{ color: tokens.colorBrandForegroundLink }}>{version}</span>
          <span style={{ color: tokens.colorNeutralForeground2 }}> - {new Date().toLocaleDateString()}</span>
        </h2>
        <Text
          block
          style={{ marginBottom: '8px' }}
          ref={(el) => {
            if (el) {
              // Find all anchor tags and attach click handler
              const anchors = el.getElementsByTagName('a')
              for (const element of anchors) {
                element.style.color = tokens.colorBrandForegroundLink
                element.onclick = (e) => {
                  e.preventDefault()
                  const href = element.getAttribute('href')
                  if (href) {
                    globalThis.api
                      .invoke('web-open-url', href)
                      .catch((error) => console.error('Unable to open release notes link', error))
                  }
                }
              }
            }
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: DomPurify.sanitize(note) }} />
        </Text>
      </div>
    )
  }

  const releaseNotesDialog = () => {
    if (!releaseNotes) return null
    const releaseNotesContent = Array.isArray(releaseNotes.releaseNotes)
      ? releaseNotes.releaseNotes.map((note) => releaseNotesItem(note.version, note.note))
      : releaseNotesItem(releaseNotes.version, releaseNotes.releaseNotes)

    return (
      <Dialog open={isReleaseNotesDialogOpened} onOpenChange={(_, data) => setIsReleaseNotesDialogOpened(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Release notes</DialogTitle>
            <DialogContent>{releaseNotesContent}</DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={busy} onClick={runAction}>
                {actionLabel}
              </Button>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">Close</Button>
              </DialogTrigger>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    )
  }

  useEffect(() => {
    let active = true
    let receivedState = false
    const unsubscribeState = globalThis.api.receive('update:state-changed', (next: UpdateState) => {
      receivedState = true
      setState(next)
      setDismissed(false)
      if (next.status === 'downloading' || next.status === 'installing') setIsReleaseNotesDialogOpened(false)
    })
    const unsubscribeNotes = globalThis.api.receive('update:show-releaseNotes', () => {
      setIsReleaseNotesDialogOpened(true)
    })
    globalThis.api
      .invoke('update:get-state')
      .then((snapshot: UpdateState) => {
        if (active && !receivedState) setState(snapshot)
      })
      .catch((error) => console.error('Unable to load update state', error))
    return () => {
      active = false
      unsubscribeState()
      unsubscribeNotes()
      dismissNotification()
    }
  }, [])

  return (
    <>
      <Toaster
        className="update-toaster"
        toasterId={toasterId}
        position="bottom-end"
        offset={{ horizontal: 16, vertical: 16 }}
        announce={() => undefined}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' || event.key === 'Delete') {
            event.preventDefault()
            event.stopPropagation()
            if (state.status === 'available') dismissAvailableUpdate()
          }
        }}
      />
      <div className="update-announcement" role="status" aria-live="polite" aria-atomic="true">
        {dismissed ? '' : title}
      </div>
      {releaseNotesDialog()}
    </>
  )
}

export default UpdateNotification
