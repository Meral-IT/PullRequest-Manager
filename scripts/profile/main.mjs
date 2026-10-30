import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron'
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { setInterval as interval, setTimeout as delay } from 'node:timers/promises'
import { createFixture, summarizeSamples } from './fixtures.mjs'
import { readProfileConfig } from './config.mjs'

const config = readProfileConfig(process.env.PR_PROFILE_CONFIG)
app.setPath('userData', config.userData)
// Profiling never changes the host's login items or requests its credential store.
app.setLoginItemSettings = () => undefined
app.getLoginItemSettings = () => ({ openAtLogin: false })
const report = {
  count: config.count,
  run: config.run,
  status: 'running',
  stage: 'startup',
  samples: [],
  interactions: [],
  cycles: [],
  refreshes: [],
  maxActiveRefreshes: 0,
  versions: process.versions,
}
let monitor
let finishing = false
let service
let window
const checkpoint = () => fs.writeFile(config.result, JSON.stringify(report, null, 2))
async function finish(error) {
  if (finishing) return
  finishing = true
  clearInterval(monitor)
  service?.stop()
  report.status = error ? 'failed' : 'passed'
  if (error) report.error = String(error.stack ?? error)
  await checkpoint()
  app.exit(error ? 1 : 0)
}
async function waitFor(expression, label) {
  const deadline = performance.now() + 15000
  if (await window.webContents.executeJavaScript(expression)) return
  for await (const expires of interval(50, deadline)) {
    if (performance.now() >= expires) break
    if (await window.webContents.executeJavaScript(expression)) return
  }
  throw new Error(
    `Timed out: ${label}; renderer: ${await window.webContents.executeJavaScript('JSON.stringify({text:document.body.innerText.slice(-2000),selects:Array.from(document.querySelectorAll("select")).map(el=>({name:el.name,value:el.value}))})')}`
  )
}
async function interact(name, expression, predicate = 'true') {
  report.stage = name
  await checkpoint()
  const started = performance.now()
  await window.webContents.executeJavaScript(
    `(async () => { ${expression}; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })()`
  )
  await waitFor(predicate, name)
  report.interactions.push({ name, ms: performance.now() - started })
}
async function resources() {
  await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
  const dom = await window.webContents.debugger.sendCommand('Memory.getDOMCounters')
  return {
    rssMiB: app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize / 1024, 0),
    ...dom,
    mainListeners: [app, ipcMain, nativeTheme, window, window.webContents].reduce(
      (sum, emitter) => sum + emitter.eventNames().reduce((n, name) => n + emitter.listenerCount(name), 0),
      0
    ),
    loadingListeners: loader.loadingEvent.listenerCount('loading'),
    timers: process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length,
    windows: BrowserWindow.getAllWindows().length,
    tray: Boolean(getTrayManager()),
    loading: loader.isLoading,
    polling: Boolean(service.pollTimer),
  }
}
let loader
let getTrayManager
async function runCycle(fixture, cycle) {
  fixture.setMode('slow')
  report.stage = 'refresh'
  const before = fixture.stats().requests
  const started = performance.now()
  const pending = service.updateDataImmediately()
  const during = service.updateDataImmediately()
  const refreshStart = performance.now()
  await interact(
    'filter-show',
    `document.querySelector('[aria-label="Filters"]').click()`,
    `Boolean(document.querySelector('[aria-label="Search pull requests"]'))`
  )
  await interact(
    'search',
    `const input=document.querySelector('[aria-label="Search pull requests"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Fixture PR 00001'); input.dispatchEvent(new Event('input',{bubbles:true}))`
  )
  await interact(
    'filter-branch-open',
    `document.querySelector('[aria-label="Target branch"]').click()`,
    `Boolean(document.querySelector('[role="option"]'))`
  )
  await interact(
    'filter-branch-select',
    `Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent==='${config.count ? 'main' : 'All target branches'}').click()`
  )
  await interact(
    'filter-clear',
    `document.querySelector('[aria-label="Clear all filters and hide filter bar"]').click()`
  )
  if (config.count) await interact('sort', `document.querySelector('[role="columnheader"]').click()`)
  await interact(
    'profile-review',
    `Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent.startsWith('Review')).click()`
  )
  await interact(
    'profile-all',
    `Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent.startsWith('All')).click()`
  )
  report.stage = 'settings-navigation'
  const navStart = performance.now()
  await window.webContents.executeJavaScript("location.hash = '#/settings/appearance'")
  await waitFor(`document.body.innerText.includes('Save Settings')`, 'settings navigation')
  report.interactions.push({ name: 'settings-navigation', ms: performance.now() - navStart })
  await waitFor(
    `document.querySelector('select[name="appearanceTheme"]').value === '${cycle % 2 === 0 ? 'light' : 'dark'}'`,
    'loaded settings theme'
  )
  await interact(
    'settings-theme',
    `const control=document.querySelector('select[name="appearanceTheme"]'); if(!control) throw new Error('Theme selector missing'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(control,'${cycle % 2 === 0 ? 'dark' : 'light'}'); control.dispatchEvent(new Event('input',{bubbles:true})); control.dispatchEvent(new Event('change',{bubbles:true}))`
  )
  await interact(
    'settings-save',
    `Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Save Settings').click()`,
    `(async () => (await globalThis.api.invoke('get-settings')).appearance.theme === '${cycle % 2 === 0 ? 'dark' : 'light'}' && !document.body.innerText.includes('Saving settings') && !document.querySelector('[role="alert"]'))()`
  )
  const homeStart = performance.now()
  await window.webContents.executeJavaScript("location.hash = '#/'")
  await waitFor('Boolean(document.querySelector("[aria-label=Filters]"))', 'home navigation')
  report.interactions.push({ name: 'home-navigation', ms: performance.now() - homeStart })
  await Promise.all([pending, during])
  fixture.setMode('healthy')
  await service.updateDataImmediately()
  await delay(200)
  report.cycles.push({
    cycle,
    refreshMs: performance.now() - started,
    duringRefreshMs: performance.now() - refreshStart,
    requests: fixture.stats().requests - before,
    resources: await resources(),
  })
  await checkpoint()
}

async function checkRecovery(fixture, mode) {
  report.stage = mode
  fixture.setMode(mode)
  await service.updateDataImmediately()
  if (!service.getPullRequests().error || loader.isLoading) throw new Error(`${mode}: missing error or stuck loading`)
  fixture.setMode('healthy')
  await service.updateDataImmediately()
  if (service.getPullRequests().error || service.getPullRequests().items.length !== config.count || loader.isLoading)
    throw new Error(`${mode}: recovery failed`)
}

async function run() {
  await app.whenReady()
  // Deny renderer HTTP traffic too; all synthetic SDK operations stay in process.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (_details, callback) =>
    callback({ cancel: true })
  )
  const fixture = createFixture({ count: config.count })
  const [{ AzureDevOpsService }, { default: createWindow }, { PullRequestUpdateManager }, loading, tray] =
    await Promise.all([
      import('../../lib/azure-devops/azure-devops.service'),
      import('../../lib/main/app'),
      import('../../lib/main/update'),
      import('../../lib/tools/loading.service'),
      import('../../lib/main/tray'),
    ])
  loader = loading.default
  getTrayManager = tray.getTrayManager
  service = AzureDevOpsService.getInstance()
  service.initializeApi = () => fixture.api
  let activeRefreshes = 0
  const updateData = service.updateData.bind(service)
  service.updateData = async () => {
    const started = performance.now()
    const phase = report.stage
    const before = fixture.stats().requests
    report.maxActiveRefreshes = Math.max(report.maxActiveRefreshes, ++activeRefreshes)
    try {
      return await updateData()
    } finally {
      activeRefreshes--
      report.refreshes.push({
        phase,
        ms: performance.now() - started,
        requests: fixture.stats().requests - before,
        error: service.getPullRequests().error?.message ?? null,
      })
    }
  }
  const setConfiguration = service.setConfiguration.bind(service)
  service.setConfiguration = (settings) => setConfiguration({ ...settings, pat: 'synthetic-in-memory-only' })
  PullRequestUpdateManager.getInstance().checkForUpdates = async () => undefined
  monitor = setInterval(() => {
    const metrics = app.getAppMetrics()
    const sample = {
      phase: report.stage,
      rssMiB: metrics.reduce((sum, item) => sum + item.memory.workingSetSize / 1024, 0),
      cpuPercent: metrics.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0),
    }
    report.samples.push(sample)
    if (sample.rssMiB > 2560)
      finish(new Error('Safety limit: app resident memory exceeded 2560 MiB')).catch(() => app.exit(2))
  }, 250)
  window = createWindow()
  window.webContents.on('render-process-gone', (_event, details) =>
    finish(new Error(`Renderer exited: ${details.reason}`)).catch(() => app.exit(2))
  )
  await new Promise((resolve, reject) => {
    window.webContents.once('did-finish-load', resolve)
    window.webContents.once('did-fail-load', (_event, code, description) =>
      reject(new Error(`Load failed ${code}: ${description}`))
    )
  })
  window.show()
  await waitFor('Boolean(document.querySelector("[role=tab]"))', 'renderer ready')
  report.startupMs = Date.now() - config.launchedAtMs
  service.stop()
  await service.updateDataImmediately()
  await waitFor(
    config.count
      ? `document.querySelectorAll('[role="row"]').length === ${config.count + 1}`
      : `document.body.innerText.includes('Currently, no pull requests')`,
    'initial PR rendering'
  )
  report.initialReadyMs = Date.now() - config.launchedAtMs
  window.webContents.debugger.attach('1.3')
  report.initial = await resources()
  report.stage = 'idle'
  await delay(1500)
  report.idle = summarizeSamples(report.samples.filter((sample) => sample.phase === 'idle'))
  // The validated workload uses three cycles on the same window and saved settings.
  await runCycle(fixture, 0)
  await runCycle(fixture, 1)
  await runCycle(fixture, 2)
  await checkRecovery(fixture, 'offline')
  await checkRecovery(fixture, 'failing')
  report.stage = 'connection-replacement'
  fixture.setMode('slow')
  const stale = service.updateDataImmediately()
  await delay(10)
  const connection = { ...service.settings, project: 'replacement' }
  service.setConfiguration(connection)
  if (service.getPullRequests().items.length) throw new Error('Replacement retained stale PRs')
  await stale
  if (service.getPullRequests().items.length) throw new Error('Old refresh published after replacement')
  fixture.setMode('healthy')
  await service.updateDataImmediately()
  if (service.getPullRequests().items.length !== config.count || loader.isLoading)
    throw new Error('Replacement did not recover')
  report.stage = 'periodic-coalescing'
  fixture.setMode('slow')
  service.start()
  await delay(120)
  const concurrent = Array.from({ length: 8 }, () => service.updateDataImmediately())
  await Promise.all(concurrent)
  service.stop()
  if (report.maxActiveRefreshes !== 1) throw new Error('Periodic/manual refresh overlapped')
  fixture.setMode('healthy')
  const stats = fixture.stats()
  for (const kind of ['identity', 'description', 'policy'])
    if ((stats.byKind[kind]?.maxConcurrency ?? 0) > 4) throw new Error(`Unbounded ${kind} requests`)
  if (stats.active || loader.isLoading || service.pollTimer) throw new Error('Resources still active')
  report.requests = stats
  await delay(200)
  report.final = await resources()
  const warm = report.cycles[0].resources
  const settled = report.cycles.at(-1).resources
  report.stability = {
    rssGrowthMiB: settled.rssMiB - warm.rssMiB,
    mainListenerGrowth: settled.mainListeners - warm.mainListeners,
    rendererListenerGrowth: settled.jsEventListeners - warm.jsEventListeners,
    timerGrowth: settled.timers - warm.timers,
    windows: settled.windows,
    tray: settled.tray,
    loading: settled.loading,
    polling: settled.polling,
  }
  report.stability.passed =
    report.stability.rssGrowthMiB <= Math.max(128, warm.rssMiB * 0.25) &&
    report.stability.mainListenerGrowth === 0 &&
    report.stability.rendererListenerGrowth <= 16 &&
    report.stability.timerGrowth === 0 &&
    settled.windows === 1 &&
    settled.tray &&
    !settled.loading &&
    !settled.polling
  if (!report.stability.passed) throw new Error('Resources did not stabilize within the three-cycle guard')
  report.refresh = summarizeSamples(report.samples.filter((sample) => sample.phase !== 'idle'))
  report.rssPeakMiB = Math.max(...report.samples.map((sample) => sample.rssMiB))
  report.interactionMaxMs = Math.max(...report.interactions.map((interaction) => interaction.ms))
  report.recovery = { offline: true, failing: true, connectionReplacement: true, coalescing: true, bounded: true }
  // Raw 250ms samples stay compact; the summaries retain phase and peak evidence.
  report.samples = report.samples.map((sample) => ({
    ...sample,
    rssMiB: Math.round(sample.rssMiB),
    cpuPercent: Math.round(sample.cpuPercent * 10) / 10,
  }))
}
async function startProfile() {
  try {
    await run()
  } catch (error) {
    await finish(error)
    return
  }
  await finish()
}
// Electron's ESM bootstrap must finish before readiness can fire.
app.once('ready', () => {
  startProfile().catch(() => app.exit(2))
})
