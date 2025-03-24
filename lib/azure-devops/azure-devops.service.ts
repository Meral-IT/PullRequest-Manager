import * as azdev from 'azure-devops-node-api'
import { CommentThreadStatus, PullRequestAsyncStatus } from 'azure-devops-node-api/interfaces/GitInterfaces'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import { PullRequestData } from '../models/pr-data'
import { AzDoSettings } from '../models/settings.model'
import { PullRequest, PullRequestThreadState } from '../models/pull-request.model'
import { ErrorType } from '../models/error-detail'
import log from 'electron-log/main'

const cacheDir = path.join(app.getPath('userData'), 'Cache', 'AzureDevOnpom psImages')
const settingFile = path.join(cacheDir, 'azdo-image-cache.json')
const cacheEvictionInterval = 1000 * 60 * 60 * 24 * 7 // 1 week

let settings: AzDoSettings
let api: azdev.WebApi
let active: boolean

export function stop(): void {
  if (!active) {
    return
  }
  active = false
}

function convert(rowState: CommentThreadStatus | undefined): PullRequestThreadState {
  if (!rowState) {
    return PullRequestThreadState.Unknown
  }
  return PullRequestThreadState[CommentThreadStatus[rowState] as keyof typeof PullRequestThreadState]
}

async function onTickCore(): Promise<void> {
  const data: PullRequestData = {
    items: [],
    error: null,
  }

  if (isValidSettings(settings) && api) {
    log.debug('Fetching data from Azure DevOps')
    try {
      const buildApi = await api.getGitApi(settings.organizationUrl, [api.authHandler])
      data.items = (await buildApi.getPullRequestsByProject(settings.project, {})).map((pr) => {
        return {
          id: pr.pullRequestId,
          author: {
            id: pr.createdBy?.id ?? '',
            label: pr.createdBy?.displayName ?? '',
            isBot: pr.createdBy?.descriptor?.startsWith('svc') ?? false,
          },
          lastUpdated: {
            label: pr.lastMergeCommit?.comment ?? '',
            timestamp: pr.lastMergeCommit?.push?.date ?? 0,
          },
          interactions: {
            threads: [],
            activeThreads: 0,
            activeFromBots: 0,
          },
          details: {
            label: pr.title,
            number: pr.pullRequestId,
            repositoryId: pr.repository?.id ?? '',
            repository: pr.repository?.name ?? '',
            projectId: pr.repository?.project?.id ?? '',
            branch: pr.sourceRefName,
            isDraft: pr.isDraft,
            isConflict: pr.mergeStatus === PullRequestAsyncStatus.Conflicts,
          },
          reviewers: pr.reviewers?.map((reviewer) => {
            return {
              user: {
                id: reviewer.id,
                label: reviewer.displayName,
                isBot: reviewer.isAadIdentity,
                imageUrl: reviewer.imageUrl,
                imageBase64: undefined,
              },
              isRequired: reviewer.isRequired,
              vote: reviewer.vote as any,
            }
          }),
        } as PullRequest
      })

      const threads = await Promise.all(
        data.items.map(async (pr) => {
          return {
            pr: pr.id,
            threads: await buildApi.getThreads(pr.details.repositoryId, pr.id, pr.details.projectId),
          }
        })
      )

      for (const pr of data.items) {
        const thread = threads.find((thread) => thread.pr === pr.id)
        if (thread) {
          pr.interactions.threads = thread.threads
            .filter((x) => !x.properties || !('CodeReviewThreadType' in x.properties))
            .map((thread) => {
              return {
                id: thread.id ?? 0,
                state: convert(thread.status),
                comments:
                  thread.comments?.map((comment) => {
                    return {
                      id: comment.id ?? 0,
                      content: comment.content ?? '',
                      author: {
                        id: comment.author?.id ?? '',
                        label: comment.author?.displayName ?? '',
                        isBot:
                          (comment.author?.descriptor?.startsWith('svc') ||
                            comment.author?.descriptor?.startsWith('s2s')) ??
                          false,
                        imageUrl: comment.author?.imageUrl,
                      },
                    }
                  }) ?? [],
              }
            })
          pr.interactions.activeThreads = pr.interactions.threads.filter(
            (thread) =>
              thread.state === PullRequestThreadState.Active || thread.state === PullRequestThreadState.Pending
          ).length
        }
      }

      log.debug('Completed to fetch data')
    } catch (error) {
      log.error('Failed to fetch data', error)
      if (error instanceof Error) {
        const statusCode = (error as AzError).statusCode ?? 0
        const errorType = statusCode === 401 ? ErrorType.Authentication : ErrorType.Unknown
        data.error = {
          message: error.message,
          details: 'Please check your authentication settings.',
          type: errorType,
          actionText: errorType === ErrorType.Authentication ? 'DevOps Settings' : undefined,
          actionHref: errorType === ErrorType.Authentication ? '/settings/azure-devops' : undefined,
        }
      }
    }
  } else {
    data.error = {
      message: 'Configuration required',
      details: 'Please set-up an integration first to get started.',
      type: ErrorType.ConfigurationRequired,
      actionText: 'Settings',
      actionHref: '/settings',
    }
  }

  // await enrichImages(data.items)

  try {
    BrowserWindow.getAllWindows()[0].webContents.send('pr-data', data)
  } catch (error) {
    log.error(error)
  }
}

// async function readImageCacheIndex(): Promise<ImageCacheIndex> {
//   try {
//     await fs.access(settingFile)
//   } catch (error) {
//     fs.mkdir(cacheDir, { recursive: true })
//     await fs.writeFile(settingFile, JSON.stringify({ data: {} }, null, 2))
//   }
//   const data = await fs.readFile(settingFile, 'utf-8')
//   return JSON.parse(data)
// }

// async function getLocalUserImageFileName(
//   id: string,
//   imageUrl: string,
//   ImageCacheIndex: ImageCacheIndex
// ): Promise<string> {
//   if (!imageUrl) {
//     return ''
//   }
//   const profileApi = await api.getProfileApi(settings.organizationUrl, [api.authHandler])
//   const cache = ImageCacheIndex.data[id]
//   if (cache) {
//     const lastUpdated = new Date(cache.lastUpdated)
//     const now = new Date()

//     // check if the image is still valid
//     if (now.getTime() - lastUpdated.getTime() > cacheEvictionInterval) {
//       delete ImageCacheIndex.data[id]
//     }
//   }

//   // const avatar = await profileApi.getAvatar(id, 'medium')
//   // const imageFileName = path.join(cacheDir, `${id}.png`)
//   // await fs.writeFile(imageFileName, response.result)

//   ImageCacheIndex.data[id] = {
//     imageFileName,
//     lastUpdated: Date.now(),
//   }

//   return imageFileName
// }

// async function getUserImageBase64(id: string, imageUrl: string, ImageCacheIndex: ImageCacheIndex): Promise<string> {
//   const imageFileName = await getLocalUserImageFileName(id, imageUrl, ImageCacheIndex)
//   if (!imageFileName) {
//     return ''
//   }

//   return fs.readFile(imageFileName, 'base64')
// }

// async function enrichImages(data: PullRequest[]): Promise<void> {
//   const cacheIndex = await readImageCacheIndex()

//   // Enrich author and reviewer images
//   for (const pr of data) {
//     if (pr.author.imageUrl) {
//       pr.author.imageBase64 = await getUserImageBase64(pr.author.id, pr.author.imageUrl, cacheIndex)
//     }

//     for (const reviewer of pr.reviewers) {
//       if (reviewer.user.imageUrl) {
//         reviewer.user.imageBase64 = await getUserImageBase64(reviewer.user.id, reviewer.user.imageUrl, cacheIndex)
//       }
//     }
//   }

//   // save cache index
//   await fs.writeFile(settingFile, JSON.stringify(cacheIndex, null, 2))
// }

function initializeApi(): azdev.WebApi {
  if (!settings) {
    throw new Error('Settings not set')
  }

  const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat)
  const options = {
    allowRetries: true,
    maxRetries: 20,
    socketTimeout: 30000,
  }
  return new azdev.WebApi(settings.organizationUrl, authHandler, options)
}

function reInitializeApi(): void {
  api = initializeApi()
}

async function onTick(): Promise<void> {
  if (!active) {
    return
  }

  await onTickCore()
  setTimeout(onTick, settings.updateInterval)
}

function startCore(): void {
  reInitializeApi()
  active = true

  onTick()
}

function isValidSettings(input?: AzDoSettings): boolean {
  if (!input) {
    return false
  }

  return !!input.organizationUrl && !!input.project && !!input.pat
}

export function setConfiguration(input: AzDoSettings): void {
  settings = input

  reInitializeApi()
}

export function start(): void {
  if (!active) {
    startCore()
  }
}

interface AzError extends Error {
  statusCode: number
}

interface ImageCacheIndex {
  data: CachedImageData
}

interface CachedImageData {
  [key: string]: CachedImage
}

interface CachedImage {
  imageFileName: string
  lastUpdated: number
}
