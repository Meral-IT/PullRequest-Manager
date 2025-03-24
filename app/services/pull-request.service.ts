import { PullRequestData } from '@/lib/models/pr-data'
import { PullRequest } from '@/lib/models/pull-request.model'

const registeredCallbacks: ((data: PullRequestData) => void)[] = []
let pullRequests: PullRequestData = {
  items: [],
  error: null,
}
const changeToken = {
  token: '',
}

export function registerDataUpdateCallback(callback: (data: PullRequestData) => void): void {
  registeredCallbacks.push(callback)
}

export function unregisterDataUpdateCallback(callback: (data: PullRequestData) => void): void {
  const index = registeredCallbacks.indexOf(callback)
  if (index !== -1) {
    registeredCallbacks.splice(index, 1)
  }
}

function generateGuid() {
  let result
  let i
  let j
  result = ''
  for (j = 0; j < 32; j += 1) {
    if (j === 8 || j === 12 || j === 16 || j === 20) result += '-'
    i = Math.floor(Math.random() * 16)
      .toString(16)
      .toUpperCase()
    result += i
  }
  return result
}

export function initializeIpcUpdateListener(): void {
  window.api.receive('pr-data', (data) => {
    pullRequests = data
    changeToken.token = generateGuid()

    registeredCallbacks.forEach((callback) => {
      callback(pullRequests)
    })
  })
}

export function getPullRequestChangeToken(): { token: string } {
  return changeToken
}

export function getPullRequests(): PullRequest[] {
  return pullRequests.items
}

export function getPullRequestData(): PullRequestData {
  return pullRequests
}
