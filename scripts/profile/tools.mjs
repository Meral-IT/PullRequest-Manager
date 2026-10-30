import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export function profileToolPaths(platform) {
  if (platform === 'darwin') return { gitExecutable: '/usr/bin/git' }
  // shortcut: Windows uses standard protected install paths; extend the allowlist for other native hosts.
  if (platform === 'win32')
    return {
      gitExecutable: String.raw`C:\Program Files\Git\cmd\git.exe`,
      taskkillExecutable: String.raw`C:\Windows\System32\taskkill.exe`,
    }
  throw new Error('Run on native macOS or Windows')
}

export async function sourceSha256(root, sourceFiles) {
  const hash = createHash('sha256')
  const contents = await Promise.all(sourceFiles.map((file) => fs.readFile(path.join(root, file))))
  for (const [index, file] of sourceFiles.entries()) hash.update(file).update(contents[index])
  return hash.digest('hex')
}
