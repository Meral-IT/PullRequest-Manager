/* eslint import/prefer-default-export: off */
import { URL } from 'url'
import path from 'path'
import { app } from 'electron'

export function resolveHtmlPath(htmlFileName: string): string {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1212
    const url = new URL(`http://localhost:${port}`)
    url.pathname = htmlFileName
    return url.href
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`
}

const RESOURCES_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'resources')
  : path.join(__dirname, '../../resources')

export function getAssetPath(...paths: string[]): string {
  return path.join(RESOURCES_PATH, ...paths)
}

export function isDebug(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'
}
