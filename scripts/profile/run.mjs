import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { profileTemporaryRoot } from './config.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtureSettings, evaluateBudgets, summarizeSamples } from './fixtures.mjs'
import { profileToolPaths, sourceSha256 } from './tools.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const output = path.resolve(
  args.includes('--output') ? args[args.indexOf('--output') + 1] : 'temp/resource-profile.json'
)
const selected = args.includes('--count') ? [Number(args[args.indexOf('--count') + 1])] : [0, 32, 1000, 10000]
if (selected.some((count) => ![0, 32, 1000, 10000].includes(count))) throw new Error('Use --count 0, 32, 1000 or 10000')
const { gitExecutable, taskkillExecutable } = profileToolPaths(process.platform)
const macDirectory = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
const executable =
  process.platform === 'darwin'
    ? path.join(root, `dist/profile/${macDirectory}/PullRequest-Manager.app/Contents/MacOS/PullRequest-Manager`)
    : path.join(root, 'dist/profile/win-unpacked/PullRequest-Manager.exe')
await fs.access(executable)
if (process.platform === 'win32') await fs.access(taskkillExecutable)
const sourceFiles = execFileSync(
  gitExecutable,
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    'app',
    'lib',
    'scripts/profile',
    'electron.vite.config.mts',
    'electron.profile.config.mts',
    'electron-builder.yml',
    'electron-builder.profile.yml',
    'package.json',
    'package-lock.json',
  ],
  { cwd: root, encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)
  .sort()
const report = {
  schema: 1,
  sourceSha256: await sourceSha256(root, sourceFiles),
  appAsarSha256: createHash('sha256')
    .update(
      await fs.readFile(
        process.platform === 'darwin'
          ? path.resolve(path.dirname(executable), '../Resources/app.asar')
          : path.resolve(path.dirname(executable), 'resources/app.asar')
      )
    )
    .digest('hex'),
  measuredAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryGiB: os.totalmem() / 1024 ** 3,
  },
  appVersion: JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version,
  revision: execFileSync(gitExecutable, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync(gitExecutable, ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  methodology:
    'Separate packaged profile main; real renderer/preload/window/tray/IPC/settings/service. SDK calls replaced by deterministic in-process synthetic requests (1ms healthy, 25ms slow), no wire latency or retries. RSS/CPU sum Electron getAppMetrics; controls use two animation frames and readiness predicates; navigation uses DOM readiness only. DOM/listeners after explicit renderer GC. Not a live Azure/network benchmark.',
  limits: { processTimeoutMs: 120000, stepTimeoutMs: 15000, residentMemoryMiB: 2560 },
  runs: [],
}
await fs.mkdir(path.dirname(output), { recursive: true })
let interrupted = false
profiles: for (const count of selected) {
  for (const run of Array.from({ length: args.includes('--once') ? 1 : 2 }, (_, index) => index + 1)) {
    const temporary = await fs.mkdtemp(path.join(profileTemporaryRoot, 'prm-profile-'))
    const config = {
      count,
      run,
      cycles: 3,
      userData: path.join(temporary, 'user-data'),
      result: path.join(temporary, 'result.json'),
      launchedAtMs: Date.now(),
    }
    await fs.mkdir(config.userData)
    await fs.writeFile(path.join(config.userData, 'settings.json'), JSON.stringify(fixtureSettings), { mode: 0o600 })
    const configPath = path.join(temporary, 'config.json')
    await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
    const env = { ...process.env, PR_PROFILE_CONFIG: configPath }
    delete env.ELECTRON_RUN_AS_NODE
    console.log(`Profiling packaged ${process.platform}/${process.arch}: ${count} PRs, run ${run}`)
    const child = spawn(executable, [], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: false,
    })
    let diagnostics = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-4000)
      })
    let timedOut = false
    const kill = () => {
      if (!child.pid) return
      if (process.platform === 'win32')
        spawn(taskkillExecutable, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Already exited. */
        }
      }
    }
    const timeout = setTimeout(() => {
      timedOut = true
      kill()
    }, report.limits.processTimeoutMs)
    const interrupt = () => {
      interrupted = true
      kill()
    }
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    let exit
    try {
      exit = await new Promise((resolve) => {
        child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }))
        child.once('exit', (code, signal) => resolve({ code, signal }))
      })
      let result
      try {
        result = JSON.parse(await fs.readFile(config.result, 'utf8'))
      } catch {
        result = { count, run, status: 'failed', stage: 'launch', error: exit.error ?? diagnostics }
      }
      if (timedOut)
        Object.assign(result, {
          status: 'failed',
          error: 'Process safety timeout (120000ms); last completed stage retained',
        })
      if (result.samples?.length) {
        result.rssPeakMiB ??= Math.max(...result.samples.map((sample) => sample.rssMiB))
        result.samplePhases = Object.entries(Object.groupBy(result.samples, (sample) => sample.phase)).map(
          ([phase, samples]) => ({ phase, ...summarizeSamples(samples) })
        )
        delete result.samples
      }
      result.idleCpuMeanPercent = result.idle?.cpuMeanPercent ?? null
      result.refreshCpuMeanPercent = result.refresh?.cpuMeanPercent ?? null
      result.refreshMaxMs = result.refreshes?.length ? Math.max(...result.refreshes.map((refresh) => refresh.ms)) : null
      result.requestMaxConcurrency = result.requests?.maxConcurrency ?? null
      result.exit = exit
      if (exit.code !== 0) result.status = 'failed'
      report.runs.push(result)
      console.log(`${count} PRs run ${run}: ${result.status}, last stage ${result.stage}`)
      await fs.writeFile(output, JSON.stringify(report, null, 2))
    } finally {
      clearTimeout(timeout)
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
      kill()
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
    if (interrupted) break profiles
  }
}
const budgetsPath = path.join(root, 'scripts/profile/budgets.json')
try {
  const budgets = JSON.parse(await fs.readFile(budgetsPath, 'utf8'))
  report.budgetScope = 'macOS measured baseline; Windows pending calibration'
  if (process.platform === 'darwin')
    for (const run of report.runs) run.budgets = evaluateBudgets(run, budgets[String(run.count)] ?? {})
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await fs.writeFile(output, JSON.stringify(report, null, 2))
console.log(`Saved ${output}`)
if (interrupted) process.exitCode = 130
if (!interrupted && report.runs.some((run) => run.status !== 'passed' || run.budgets?.some((budget) => !budget.passed)))
  process.exitCode = 1
