import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Link,
  ProgressBar,
  Text,
  Toast,
  ToastBody,
  Toaster,
  ToastFooter,
  ToastTitle,
  ToastTrigger,
  tokens,
  useId,
  useToastController,
} from '@fluentui/react-components'
import { DismissFilled } from '@fluentui/react-icons'
import DomPurify from 'dompurify'
import { ProgressInfo, UpdateInfo } from 'electron-updater'
import { useEffect, useState } from 'react'
import './update-notification.component.scss'

function UpdateNotification() {
  const updateAvailableToastId = useId('updateAvailableToastId')
  const downloadProgressToastId = useId('downloadProgressToastId')
  const toasterId = useId('toaster')
  const [isReleaseNotesDialogOpened, setIsReleaseNotesDialogOpened] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState<UpdateInfo>({} as UpdateInfo)
  const { dispatchToast, dismissToast, updateToast } = useToastController(toasterId)

  const installUpdate = () => {
    dismissToast(updateAvailableToastId)
    createDownloadingUpdateToast({ bytesPerSecond: 0, percent: 0, total: 0, delta: 0, transferred: 0 })
    window.api.invoke('update:install-update')
  }

  const updateNotify = () => {
    dispatchToast(
      <Toast>
        <ToastTitle
          action={
            <ToastTrigger>
              <Link>
                <DismissFilled />
              </Link>
            </ToastTrigger>
          }
        >
          Update available!
        </ToastTitle>
        <ToastFooter>
          <Button appearance="primary" onClick={installUpdate}>
            Update
          </Button>
          <Button id="release-notes-button" onClick={() => setIsReleaseNotesDialogOpened(true)}>
            Release notes
          </Button>
        </ToastFooter>
      </Toast>,
      { toastId: updateAvailableToastId, intent: 'info', timeout: -1 }
    )
  }

  const createDownloadingUpdateToast = (info: ProgressInfo) =>
    dispatchToast(
      <Toast>
        <ToastTitle>Downloading update</ToastTitle>
        <ToastBody>
          <Text>Downloading update ({info.bytesPerSecond}bytes/second)...</Text>
          <ProgressBar value={info.percent} max={100} />
        </ToastBody>
      </Toast>,
      { toastId: downloadProgressToastId, intent: 'info', timeout: -1 }
    )

  const updateDownloadingUpdateToast = (info: ProgressInfo) =>
    updateToast({
      content: (
        <Toast>
          <ToastTitle>Downloading update</ToastTitle>
          <ToastBody>
            <Text>Downloading update ({info.bytesPerSecond}bytes/second)...</Text>
            <ProgressBar value={info.percent} max={100} />
          </ToastBody>
        </Toast>
      ),
      intent: 'info',
      toastId: downloadProgressToastId,
      timeout: -1,
    })

  const releaseNotesItem = (version: string, note?: string | null) => {
    if (!note) return null
    return (
      <>
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
                    window.api.invoke('web-open-url', href)
                  }
                }
              }
            }
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: DomPurify.sanitize(note) }} />
        </Text>
      </>
    )
  }

  const releaseNotesDialog = () => {
    const releaseNotesContent = Array.isArray(releaseNotes.releaseNotes)
      ? releaseNotes.releaseNotes.map((note) => releaseNotesItem(note.version, note.note))
      : releaseNotesItem(releaseNotes.version, releaseNotes.releaseNotes)

    return (
      <Dialog open={isReleaseNotesDialogOpened} onOpenChange={(_, data) => setIsReleaseNotesDialogOpened(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Release notes</DialogTitle>
            <DialogContent>
              <Text block></Text>

              {releaseNotesContent}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={installUpdate}>
                Restart & Update
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
    return window.api.receive('update:update-available', (info: UpdateInfo) => {
      setReleaseNotes(info)
      updateNotify()
    })
  }, [])

  useEffect(() => {
    return window.api.receive('update:download-progress', (info: ProgressInfo) => {
      updateDownloadingUpdateToast(info)
    })
  }, [])

  return (
    <>
      <Toaster toasterId={toasterId} />
      {releaseNotesDialog()}
    </>
  )
}

export default UpdateNotification
