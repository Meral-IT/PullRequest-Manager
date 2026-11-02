import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve, win32 } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'
import * as React from 'react'

const __dirname = dirname(fileURLToPath(import.meta.url))
const load = createRequire(import.meta.url)
const isExternal = (id) => !id.startsWith('.') && !isAbsolute(id) && !win32.isAbsolute(id) && !id.startsWith('@/')

test('test loader bundles Windows, POSIX, relative, and aliased paths while keeping packages external', () => {
  for (const id of [
    'D:/a/project/context.ts',
    'D:\\a\\project\\context.ts',
    '/project/context.ts',
    '../context.ts',
    '@/lib/context.ts',
  ]) {
    assert.equal(isExternal(id), false, id)
  }
  assert.equal(isExternal('react'), true)
  assert.equal(isExternal('@fluentui/react-components'), true)
})

async function component(entry) {
  const states = []
  const effects = new Map()
  const cleanups = new Map()
  const setters = []
  const subscriptions = new Map()
  const listeners = new Map()
  const calls = []
  const toasts = []
  const document = new EventTarget()
  document.querySelector = () => null
  let cursor = 0
  let context
  let settings
  let dark = false
  let pathname = '/settings/general'
  let params = { profileId: 'test' }
  const api = {
    invoke: async (name, ...args) => {
      calls.push([name, ...args])
      if (name === 'get-theme') return 'system'
      if (name === 'get-settings') return settings
      if (name === 'get-pr-data') return { error: null, items: [] }
      if (name === 'approve-prs') return { succeeded: args[0].length, skipped: 0, failed: 0 }
      if (name === 'reset-pr-feedback') return { succeeded: 1, skipped: 0, failed: 0 }
      if (name === 'update:get-state') return { status: 'idle' }
      return false
    },
    receive: (name, callback) => {
      if (!subscriptions.has(name)) subscriptions.set(name, new Set())
      const callbacks = subscriptions.get(name)
      callbacks.add(callback)
      listeners.set(name, (...args) => callbacks.forEach((listener) => listener(...args)))
      return () => {
        callbacks.delete(callback)
        if (!callbacks.size) listeners.delete(name)
      }
    },
  }
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      setters[index] ??= (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
      }
      return [states[index], setters[index]]
    },
    useRef(value) {
      return hooks.useState({ current: value })[0]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      if (!states[index] || dependencies.some((value, i) => !Object.is(value, states[index][i]))) {
        effects.set(index, effect)
        states[index] = dependencies
      }
    },
    useEffectEvent(callback) {
      const ref = hooks.useRef(callback)
      ref.current = callback
      return hooks.useCallback((...args) => ref.current(...args), [])
    },
    useMemo(factory, dependencies) {
      const index = cursor++
      if (!states[index] || dependencies.some((value, i) => value !== states[index].dependencies[i]))
        states[index] = { value: factory(), dependencies }
      return states[index].value
    },
    useCallback(callback, dependencies) {
      const index = cursor++
      if (!states[index] || dependencies.some((value, i) => value !== states[index].dependencies[i]))
        states[index] = { callback, dependencies }
      return states[index].callback
    },
    useContext: () => context,
  }
  const fluent = new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === 'tokens') return {}
        if (name === 'useId') return (prefix) => hooks.useState(prefix)[0]
        if (name === 'useToastController')
          return () => ({
            dispatchToast: (content, options) => toasts.push({ content, options }),
            dismissToast: (toastId) => {
              const toast = toasts.find(({ options }) => options.toastId === toastId)
              if (toast) toast.dismissed = true
            },
            updateToast: ({ content, ...options }) => {
              const toast = toasts.find((toast) => toast.options.toastId === options.toastId)
              if (toast) {
                toast.content = content
                toast.options = options
              }
            },
          })
        if (name === 'makeStyles') return () => () => ({})
        if (name === 'makeResetStyles') return () => () => ''
        if (name === 'mergeClasses') return () => ''
        if (name === 'createTableColumn') return (column) => column
        return name
      },
    }
  )
  const { output } = await build({
    input: resolve(__dirname, '..', entry),
    write: false,
    output: { format: 'cjs', exports: 'named' },
    platform: 'node',
    transform: { jsx: 'react-jsx' },
    external: (id) => isExternal(id) || id.endsWith('/filter-editor.component'),
    resolve: {
      alias: {
        '@/app': resolve(__dirname, '../app'),
        '@/lib': resolve(__dirname, '../lib'),
        '@/resources': resolve(__dirname, '../resources'),
      },
    },
    moduleTypes: { '.scss': 'empty', '.svg': 'text' },
  })
  const result = { exports: {} }
  new Function('require', 'module', 'exports', output[0].code)(
    (name) => {
      if (name === 'react') return hooks
      if (name === 'dompurify') return { __esModule: true, default: { sanitize: (html) => html } }
      if (name === '@fluentui/react-icons') return load(name)
      if (name.startsWith('@fluentui/')) return fluent
      if (name === 'react-router-dom')
        return {
          useParams: () => params,
          useLocation: () => ({ pathname }),
          useBlocker: () => ({ state: 'unblocked' }),
          useBeforeUnload: () => {},
          useNavigate: () => (path) => calls.push(['navigate', path]),
        }
      return load(name)
    },
    result,
    result.exports
  )

  return {
    api,
    calls,
    toasts,
    listeners,
    listenerCount: (name) => subscriptions.get(name)?.size ?? 0,
    setDark: (value) => {
      dark = value
    },
    setContext: (value) => {
      context = value
    },
    setSettings: (value) => {
      settings = value
    },
    setPathname: (value) => {
      pathname = value
    },
    setParams: (value) => {
      params = value
    },
    render(props = {}, name = 'default') {
      cursor = 0
      globalThis.api = api
      globalThis.document = document
      globalThis.matchMedia = () => ({ matches: dark })
      globalThis.localStorage = { getItem: () => null, setItem: () => undefined }
      return result.exports[name](props)
    },
    async flush() {
      for (const [index, effect] of effects) {
        cleanups.get(index)?.()
        cleanups.set(index, effect())
      }
      effects.clear()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    },
    unmount() {
      for (const cleanup of cleanups.values()) cleanup?.()
      cleanups.clear()
      effects.clear()
      states.length = 0
      setters.length = 0
    },
  }
}

function elements(node, predicate) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate))
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)]
}

const profile = {
  id: 'test',
  label: 'Test',
  visible: true,
  enableAcceptAll: false,
  notifyOnNewPrs: false,
}
const settings = {
  general: {},
  azDoIntegrations: [
    {
      id: 'integration',
      name: 'Test',
      organizationUrl: '',
      project: '',
      pat: '',
      updateInterval: 180,
      intelligentApproval: true,
    },
  ],
  appearance: { tableSize: 'small', theme: 'system' },
  profiles: [profile],
}

test('profile sorting and explicit manual sorting survive load, duplication, and save', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  const sorting = { sortColumn: 'creationDate', sortDirection: 'descending' }
  provider.setSettings({ ...settings, profiles: [{ ...profile, sorting }] })
  provider.render({}, 'SettingProvider')
  await provider.flush()
  let value = provider.render({}, 'SettingProvider').props.value
  assert.deepEqual(value.state.profiles[0].sorting, sorting)
  value.actions.duplicateProfile(profile.id)
  value = provider.render({}, 'SettingProvider').props.value
  assert.deepEqual(value.state.profiles[1].sorting, sorting)
  await value.actions.saveSettings()
  assert.deepEqual(provider.calls.find(([name]) => name === 'save-settings')[1].profiles[0].sorting, sorting)
  value.actions.onChangeHandler({ profileId: profile.id, target: { name: 'sorting', value: null } })
  value = provider.render({}, 'SettingProvider').props.value
  assert.equal(value.state.profiles[0].sorting, null)
  await value.actions.saveSettings()
  const saves = provider.calls.filter(([name]) => name === 'save-settings')
  assert.equal(JSON.parse(JSON.stringify(saves.at(-1)[1])).profiles[0].sorting, null)
  provider.listeners.get('settings')(settings)
  value = provider.render({}, 'SettingProvider').props.value
  assert.equal(value.state.profiles[0].sorting, undefined)
})

test('AzDo validation leaves editable settings unchanged and discards results after editing or loading different inputs', async () => {
  for (const replaceSavedSettings of [false, true, 'restore']) {
    const provider = await component('app/components/settings/provider/setting.provider.tsx')
    provider.setSettings(settings)
    provider.render({}, 'SettingProvider')
    await provider.flush()
    let value = provider.render({}, 'SettingProvider').props.value
    if (replaceSavedSettings === 'restore') {
      value.actions.updateIntegration('integration', { pat: 'unsaved-token' })
      value = provider.render({}, 'SettingProvider').props.value
    }
    const before = structuredClone(value.state)
    let release
    provider.api.invoke = async () =>
      new Promise((resolve) => {
        release = resolve
      })
    const pending = value.actions.validateAzDo()
    if (replaceSavedSettings === 'restore') provider.listeners.get('settings')(settings)
    else if (replaceSavedSettings)
      provider.listeners.get('settings')({
        ...settings,
        azDoIntegrations: [{ ...settings.azDoIntegrations[0], project: 'replacement' }],
      })
    else value.actions.updateIntegration('integration', { pat: 'replacement' })
    release({ userDisplayName: 'Old credentials', error: null, access: { features: {} } })
    await pending
    value = provider.render({}, 'SettingProvider').props.value
    assert.equal(value.azDoValidation, undefined)
    assert.equal(value.azDoAccess, undefined)
    assert.equal(value.validatingAzDo, false)
    assert.deepEqual(value.state.profiles, before.profiles)
  }
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings(settings)
  provider.render({}, 'SettingProvider')
  await provider.flush()
  let value = provider.render({}, 'SettingProvider').props.value
  const before = structuredClone(value.state)
  provider.api.invoke = async () => ({ userDisplayName: 'Current user', error: null, access: { features: {} } })
  await value.actions.validateAzDo()
  value = provider.render({}, 'SettingProvider').props.value
  assert.deepEqual(value.state, before)
  assert.equal(value.azDoValidation.userDisplayName, 'Current user')
})

test('settings context retains its value across unchanged renders and updates after edits', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings(settings)
  provider.render({}, 'SettingProvider')
  await provider.flush()
  const initial = provider.render({}, 'SettingProvider').props.value
  assert.strictEqual(provider.render({}, 'SettingProvider').props.value, initial)
  initial.actions.updateIntegration('integration', { project: 'updated-project' })
  const updated = provider.render({}, 'SettingProvider').props.value
  assert.notStrictEqual(updated, initial)
  assert.equal(updated.state.azDoIntegrations[0].project, 'updated-project')
  assert.strictEqual(provider.render({}, 'SettingProvider').props.value, updated)
})

test('settings sidebar lists integrations and creates or opens their editors like profiles', async () => {
  const view = await component('app/components/settings/settings.component.tsx')
  const selected = []
  let added = 0
  const state = {
    ...settings,
    azDoIntegrations: [
      ...settings.azDoIntegrations,
      { ...settings.azDoIntegrations[0], id: 'second', name: 'Second connection' },
    ],
  }
  const context = {
    state,
    selectedIntegrationId: 'integration',
    dirty: false,
    actions: {
      selectIntegration: (id) => selected.push(id),
      addIntegration: () => {
        added++
        return 'created'
      },
    },
  }
  view.setContext(context)
  view.setPathname('/settings/integrations/integration')
  const sidebar = () => elements(view.render(), (element) => element.props.sidebarContent)[0].props.sidebarContent
  const group = () =>
    elements(sidebar(), (element) => element.type === 'TabList' && element.props['aria-label'] === 'Integrations')[0]
  assert.deepEqual(
    elements(group(), (element) => element.type === 'Tab').map((tab) => tab.props.children),
    ['Test', 'Second connection', 'Add Integration']
  )
  assert.equal(group().props.selectedValue, '/settings/integrations/integration')
  group().props.onTabSelect(null, { value: '/settings/integrations/second' })
  assert.deepEqual(selected, ['second'])
  assert.deepEqual(view.calls.at(-1), ['navigate', '/settings/integrations/second'])
  group().props.onTabSelect(null, { value: '/settings/integrations/new' })
  assert.equal(added, 1)
  assert.deepEqual(view.calls.at(-1), ['navigate', '/settings/integrations/created'])
  assert.equal(
    elements(sidebar(), (element) => element.type === 'Tab' && element.props.children === 'Azure DevOps').length,
    0
  )
  context.state = { ...state, azDoIntegrations: [] }
  view.setContext(context)
  assert.deepEqual(
    elements(group(), (element) => element.type === 'Tab').map((tab) => tab.props.children),
    ['Add Integration']
  )
})

test('integration repair actions open their own settings and keep legacy settings routes', async () => {
  const banner = await component('app/components/azure-devops-access-banner.tsx')
  const access = {
    requirementsFingerprint: 'requirements',
    connectionRevision: 1,
    acknowledged: false,
    features: {
      code: { status: 'denied' },
      identity: { status: 'verified' },
      vote: { status: 'verified' },
    },
  }
  const buttons = (props) => elements(banner.render(props), (element) => element.type === 'Button')
  buttons({ access, integrationId: 'second', name: 'Second connection' })[0].props.onClick()
  assert.deepEqual(banner.calls.at(-1), ['navigate', '/settings/integrations/second'])
  assert.equal(
    buttons({ access, integrationId: 'second', name: 'Second connection' })[0].props['aria-label'],
    'Second connection: Azure DevOps settings'
  )
  buttons({ access })[0].props.onClick()
  assert.deepEqual(banner.calls.at(-1), ['navigate', '/settings/azure-devops'])

  const overview = await component('app/pages/pull-requests/pull-requests.tsx')
  overview.setSettings(settings)
  overview.render()
  await overview.flush()
  overview.listeners.get('pr-data')({
    items: [],
    error: null,
    integrations: [
      {
        id: 'second',
        name: 'Second connection',
        access,
        error: { message: 'Could not load pull requests', details: 'Try again', actionHref: '/settings/azure-devops' },
      },
    ],
  })
  const tree = overview.render()
  const integrationNotices = elements(tree, (element) => element.type?.name === 'IntegrationNotices')[0]
  const integrationSettings = elements(
    integrationNotices.type(integrationNotices.props),
    (element) => element.type === 'Button' && element.props['aria-label'] === 'Second connection: Integration settings'
  )[0]
  assert.ok(integrationSettings)
  integrationSettings.props.onClick()
  assert.deepEqual(overview.calls.at(-1), ['navigate', '/settings/integrations/second'])
})

test('integration editor uses its route to select a connection and has no connection picker', async () => {
  const view = await component('app/components/settings/azdo/settings-azdo.component.tsx')
  const selected = []
  view.setParams({ integrationId: 'second' })
  view.setContext({
    state: {
      ...settings,
      azDoIntegrations: [...settings.azDoIntegrations, { ...settings.azDoIntegrations[0], id: 'second' }],
    },
    selectedIntegrationId: 'integration',
    actions: { selectIntegration: (id) => selected.push(id) },
  })
  view.render()
  await view.flush()
  assert.deepEqual(selected, ['second'])
  const tree = view.render()
  assert.equal(elements(tree, (element) => element.type === 'Select').length, 0)
  assert.equal(
    elements(tree, (element) => element.type === 'Button' && element.props.children === 'Add Integration').length,
    0
  )
})

test('integration edits stay independent through selection, save, and removal', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings(settings)
  const value = () => provider.render({}, 'SettingProvider').props.value
  value()
  await provider.flush()
  value().actions.updateIntegration('integration', { project: 'First project' })
  const secondId = value().actions.addIntegration()
  assert.equal(value().selectedIntegrationId, secondId)
  assert.notEqual(secondId, 'integration')
  value().actions.updateIntegration(secondId, {
    name: 'Second connection',
    project: 'Second project',
    pat: 'second-token',
  })
  value().actions.selectIntegration('integration')
  assert.equal(value().state.azDoIntegrations[0].project, 'First project')
  value().actions.selectIntegration(secondId)
  await value().actions.saveSettings()
  const saved = provider.calls.find(([channel]) => channel === 'save-settings')[1]
  assert.equal(saved.azDoIntegrations.length, 2)
  assert.equal(saved.azDoIntegrations[0].project, 'First project')
  assert.equal(saved.azDoIntegrations[1].pat, 'second-token')
  value().actions.deleteIntegration(secondId)
  assert.equal(value().selectedIntegrationId, 'integration')
  assert.equal(value().state.azDoIntegrations.length, 1)
  value().actions.deleteIntegration('integration')
  assert.equal(value().selectedIntegrationId, '')
  assert.deepEqual(value().state.azDoIntegrations, [])
})

test('switching integrations cancels validation and restores only the selected connection access', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings({
    ...settings,
    azDoIntegrations: [...settings.azDoIntegrations, { ...settings.azDoIntegrations[0], id: 'second' }],
  })
  const value = () => provider.render({}, 'SettingProvider').props.value
  value()
  await provider.flush()
  const access = { features: {} }
  provider.listeners.get('pr-data')({ items: [], error: null, integrations: [{ id: 'second', access }] })
  let release
  provider.api.invoke = async () =>
    new Promise((resolve) => {
      release = resolve
    })
  const pending = value().actions.validateAzDo()
  value().actions.selectIntegration('second')
  release({ userDisplayName: 'First connection', error: null, access: { features: {} } })
  await pending
  assert.equal(value().azDoValidation, undefined)
  assert.equal(value().azDoAccess, access)
  assert.equal(value().validatingAzDo, false)
})

test('AzDo connection status uses native output and retains validate, recheck, and loading labels', async () => {
  const view = await component('app/components/settings/azdo/settings-azdo.component.tsx')
  const context = { state: settings, selectedIntegrationId: 'integration', actions: {}, validatingAzDo: false }
  view.setContext(context)
  let tree = view.render()
  assert.ok(
    elements(tree, (element) => element.type === 'Button' && element.props.children === 'Validate connection').length
  )
  context.azDoValidation = { userDisplayName: 'Test User', error: null }
  view.setContext(context)
  tree = view.render()
  const field = elements(tree, (element) => element.type === 'Field' && element.props.validationMessage)[0]
  assert.equal(field.props.validationMessage.type, 'output')
  assert.equal(field.props.validationMessage.props.children, 'Connected as Test User')
  assert.ok(
    elements(tree, (element) => element.type === 'Button' && element.props.children === 'Recheck access').length
  )
  context.validatingAzDo = true
  view.setContext(context)
  assert.ok(
    elements(
      view.render(),
      (element) => element.type === 'Button' && element.props.children === 'Validating...' && element.props.disabled
    ).length
  )
})

test('profile controls default to creation descending and preserve explicit and manual sorting', async () => {
  const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
  const changes = []
  const render = (sorting) => {
    view.setContext({
      state: { profiles: [{ ...profile, sorting }] },
      actions: { onChangeHandler: (event) => changes.push(event) },
    })
    return elements(view.render(), (element) => element.type === 'Select')
  }
  let selects = render(undefined)
  assert.equal(selects.length, 2)
  assert.equal(selects[0].props.value, 'creationDate')
  assert.equal(selects[1].props.value, 'descending')
  assert.equal(selects[1].props.disabled, false)
  assert.ok(
    elements(selects[0], (element) => element.type === 'option').some((option) => option.props.value === 'creationDate')
  )
  selects[0].props.onChange({ target: { value: 'details' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'details', sortDirection: 'descending' })
  selects[1].props.onChange({ target: { value: 'ascending' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'creationDate', sortDirection: 'ascending' })
  selects = render({ sortColumn: 'details', sortDirection: 'ascending' })
  selects[0].props.onChange({ target: { value: 'author' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'author', sortDirection: 'ascending' })
  selects[1].props.onChange({ target: { value: 'descending' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'details', sortDirection: 'descending' })
  selects[0].props.onChange({ target: { value: '' } })
  assert.equal(changes.at(-1).target.value, null)
  selects = render(null)
  assert.equal(selects[0].props.value, '')
  assert.equal(selects[1].props.disabled, true)
  selects[0].props.onChange({ target: { value: 'creationDate' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'creationDate', sortDirection: 'descending' })
  selects = render({ sortColumn: 'details' })
  assert.equal(selects[1].props.value, 'descending')
})

test('grid applies both sort directions to each supported column and prevents manual changes', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  const data = [
    { id: 1, author: { label: 'Zoe' }, details: { label: 'Zulu' }, reviewers: [1, 2], evaluations: [{ status: 3 }] },
    { id: 2, author: { label: 'Ada' }, details: { label: 'Alpha' }, reviewers: [], evaluations: [] },
  ]
  const grid = (sorting) => elements(view.render({ data, sorting }), (element) => element.type === 'DataGrid')[0]
  assert.equal(grid(undefined).props.sortable, false)
  assert.equal(grid(null).props.sortable, true)
  for (const sortColumn of ['author', 'details', 'reviewers', 'statusChecks']) {
    for (const sortDirection of ['ascending', 'descending']) {
      const sorting = { sortColumn, sortDirection }
      const props = grid(sorting).props
      assert.deepEqual(
        props.items.map((pr) => pr.id),
        sortDirection === 'ascending' ? [2, 1] : [1, 2]
      )
      assert.equal(props.sortable, false)
    }
  }
  assert.deepEqual(
    data.map((pr) => pr.id),
    [1, 2]
  )
  assert.equal(grid(null).props.sortable, true)
})

test('policy cells distinguish all six states, empty checks, and mixed tooltips', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  const grid = elements(view.render({ data: [{ id: 1 }] }), (element) => element.type === 'DataGrid')[0]
  const checks = grid.props.columns.find((column) => column.columnId === 'statusChecks')
  const reviewers = grid.props.columns.find((column) => column.columnId === 'reviewers')
  const text = (node) => {
    if (Array.isArray(node)) return node.map(text).join('')
    if (node && typeof node === 'object') return text(node.props?.children)
    return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  }
  const evaluation = (status) => ({
    id: String(status),
    status,
    displayName: `Policy ${status}`,
    config: { type: { id: 'build', displayName: 'Build', url: '' } },
  })
  for (const [status, summary] of [
    [0, '1 pending'],
    [1, '1 pending'],
    [2, '1 approved'],
    [3, '1 failed'],
    [4, '1 not applicable'],
    [5, '1 failed'],
  ]) {
    const cell = checks.renderCell({ evaluations: [evaluation(status)] })
    assert.ok(elements(cell, (element) => element.props?.['aria-label'] === summary).length, summary)
    assert.ok(text(cell.props.content).includes(`Policy ${status}`))
  }
  assert.equal(text(checks.renderCell({ evaluations: [] })), 'No checks')
  assert.equal(text(reviewers.renderCell({ reviewers: [] })), 'No reviewers')
  const mixed = checks.renderCell({ evaluations: [0, 1, 2, 3, 4, 5].map(evaluation) })
  assert.equal(mixed.props.relationship, 'description')
  assert.ok(
    elements(mixed, (element) => element.props?.['aria-label'] === '2 failed, 2 pending, 1 approved, 1 not applicable')
      .length
  )
  for (const state of ['Queued', 'Running', 'Approved', 'Rejected', 'Not applicable', 'Broken']) {
    assert.ok(text(mixed.props.content).includes(state), state)
  }
  assert.equal(checks.compare({ evaluations: [evaluation(5)] }, { evaluations: [evaluation(2)] }), 1)
})

test('active profile receives saved sorting without switching tabs', async () => {
  const overview = await component('app/pages/pull-requests/pull-requests.tsx')
  overview.setSettings({ ...settings, profiles: [{ ...profile, isDefault: true }] })
  overview.render()
  await overview.flush()
  const sorting = { sortColumn: 'details', sortDirection: 'descending' }
  assert.ok(overview.listeners.has('settings'))
  overview.listeners.get('settings')({ ...settings, profiles: [{ ...profile, sorting }] })
  const list = elements(overview.render(), (element) => element.type?.name === 'PrList')[0]
  assert.deepEqual(list.props.sorting, sorting)
})

test('creation sorting orders dates chronologically, keeps ties stable, and handles missing dates', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  const data = [
    { id: 1, creationDate: new Date('2026-10-29T12:00:00Z') },
    { id: 2, creationDate: new Date('2026-10-28T12:00:00Z') },
    { id: 3 },
    { id: 4, creationDate: new Date('2026-10-29T12:00:00Z') },
  ]
  for (const [sortDirection, expected] of [
    ['ascending', [3, 2, 1, 4]],
    ['descending', [1, 4, 2, 3]],
  ]) {
    const grid = elements(
      view.render({ data, sorting: { sortColumn: 'creationDate', sortDirection } }),
      (element) => element.type === 'DataGrid'
    )[0]
    assert.deepEqual(
      grid.props.items.map((pr) => pr.id),
      expected
    )
    assert.equal(grid.props.sortable, false)
  }
  for (const sorting of [undefined, { sortColumn: 'creationDate' }]) {
    const grid = elements(view.render({ data, sorting }), (element) => element.type === 'DataGrid')[0]
    assert.deepEqual(
      grid.props.items.map((pr) => pr.id),
      [1, 4, 2, 3]
    )
    assert.equal(grid.props.sortable, false)
  }
  const manualGrid = elements(view.render({ data, sorting: null }), (element) => element.type === 'DataGrid')[0]
  assert.deepEqual(
    manualGrid.props.items.map((pr) => pr.id),
    [1, 2, 3, 4]
  )
  assert.equal(manualGrid.props.sortable, true)
  assert.deepEqual(
    data.map((pr) => pr.id),
    [1, 2, 3, 4]
  )
})

test('grid reuses sorted rows until its data or sorting changes', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  const data = [
    { id: 1, creationDate: new Date('2026-10-29') },
    { id: 2, creationDate: new Date('2026-10-28') },
  ]
  const sorting = { sortColumn: 'creationDate', sortDirection: 'ascending' }
  const rows = (props) => elements(view.render(props), (element) => element.type === 'DataGrid')[0].props.items
  const first = rows({ data, sorting })
  assert.strictEqual(rows({ data, sorting }), first)
  const descending = rows({ data, sorting: { ...sorting, sortDirection: 'descending' } })
  assert.deepEqual(
    descending.map((pr) => pr.id),
    [1, 2]
  )
  assert.notStrictEqual(descending, first)
  assert.notStrictEqual(rows({ data: [...data], sorting }), first)
})

test('profile filtering caches badges while search touches only the active profile or menu target', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  let evaluations = 0
  let searches = [0, 0]
  const filter = (id) => ({ op: 'AND', filters: [{ author: { op: 'AND', filters: [{ id }] } }] })
  const profiles = ['one', 'two'].map((id, index) => ({
    ...profile,
    id,
    label: id,
    isDefault: index === 0,
    enableAcceptAll: true,
    get filter() {
      evaluations++
      return filter(id)
    },
  }))
  const items = ['one', 'two', 'two'].map((id, index) => ({
    id: index + 1,
    author: { id, label: id },
    details: {
      label: 'Unrelated',
      repository: 'Repo',
      targetBranch: 'main',
      get description() {
        searches[index === 0 ? 0 : 1]++
        return index === 2 ? 'different' : 'needle'
      },
    },
  }))
  view.setSettings({ ...settings, profiles })
  const invoke = view.api.invoke
  view.api.invoke = (name, ...args) =>
    name === 'get-pr-data' ? Promise.resolve({ items, error: null }) : invoke(name, ...args)
  view.render()
  await view.flush()
  let tree = view.render()
  const initialEvaluations = evaluations
  view.render()
  assert.equal(evaluations, initialEvaluations)
  elements(
    tree,
    (element) => element.type === 'Button' && element.props['aria-controls'] === 'pr-filter-line'
  )[0].props.onClick()
  tree = view.render()
  elements(tree, (element) => element.type === 'Input')[0].props.onChange(null, { value: 'needle' })
  tree = view.render()
  assert.equal(evaluations, initialEvaluations)
  assert.deepEqual(searches, [1, 0])
  assert.deepEqual(
    elements(tree, (element) => element.type === 'CounterBadge').map((badge) => badge.props.children),
    [1, 2]
  )
  assert.deepEqual(
    elements(tree, (element) => element.type?.name === 'PrList')[0].props.data.map((pr) => pr.id),
    [1]
  )
  const secondTab = elements(tree, (element) => element.type === 'Tab' && element.props.value === 'two')[0]
  secondTab.props.onContextMenu({ preventDefault: () => undefined, currentTarget: { focus: () => undefined } })
  tree = view.render()
  elements(tree, (element) => element.type?.name === 'TabHeaderMenu')[0].props.onClick()
  assert.deepEqual(
    view.calls.find(([name]) => name === 'approve-prs')[1].map((pr) => pr.id),
    [2]
  )
  assert.equal(searches[1], 2)
  view.listeners.get('pr-data')({ items: [...items], error: null })
  view.render()
  assert.ok(evaluations > initialEvaluations)
  const refreshedEvaluations = evaluations
  view.listeners.get('settings')({ ...settings, profiles: [...profiles] })
  view.render()
  assert.ok(evaluations > refreshedEvaluations)
  elements(view.render(), (element) => element.type === 'TabList')[0].props.onTabSelect(null, { value: 'two' })
  assert.deepEqual(
    elements(view.render(), (element) => element.type?.name === 'PrList')[0].props.data.map((pr) => pr.id),
    [2]
  )
})

test('system theme follows repeated native updates while explicit modes ignore them and remount removes listeners', async () => {
  const view = await component('app/components/layout/layout.component.tsx')
  view.render()
  await view.flush()
  assert.equal(view.render().props.theme, 'webLightTheme')
  for (const dark of [true, false, true]) {
    view.setDark(dark)
    view.listeners.get('nativeThemeChanged')()
    assert.equal(view.render().props.theme, dark ? 'webDarkTheme' : 'webLightTheme')
  }
  for (const theme of ['light', 'dark']) {
    view.listeners.get('theme-changed')(theme)
    view.render()
    view.setDark(theme !== 'dark')
    view.listeners.get('nativeThemeChanged')()
    assert.equal(view.render().props.theme, theme === 'dark' ? 'webDarkTheme' : 'webLightTheme')
  }
  view.unmount()
  assert.equal(view.listenerCount('nativeThemeChanged'), 0)
  assert.equal(view.listenerCount('theme-changed'), 0)
  view.render()
  await view.flush()
  assert.equal(view.listenerCount('nativeThemeChanged'), 1)
  assert.equal(view.listenerCount('theme-changed'), 1)
})

test('theme startup ignores stale responses after a change event or unmount', async () => {
  const view = await component('app/components/layout/layout.component.tsx')
  let release
  view.api.invoke = () =>
    new Promise((resolve) => {
      release = resolve
    })
  view.render()
  await view.flush()
  view.listeners.get('theme-changed')('light')
  release('dark')
  await view.flush()
  assert.equal(view.render().props.theme, 'webLightTheme')
  view.unmount()
  view.render()
  await view.flush()
  const oldRelease = release
  view.unmount()
  view.api.invoke = async () => 'light'
  view.render()
  await view.flush()
  oldRelease('dark')
  await view.flush()
  assert.equal(view.render().props.theme, 'webLightTheme')
})

test('settings startup cannot overwrite settings received while its request was pending', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  let release
  provider.api.invoke = (name) =>
    name === 'get-settings'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve({ error: null, items: [] })
  provider.render({}, 'SettingProvider')
  await provider.flush()
  provider.listeners.get('settings')({
    ...settings,
    azDoIntegrations: [{ ...settings.azDoIntegrations[0], project: 'new-project' }],
  })
  release({ ...settings, azDoIntegrations: [{ ...settings.azDoIntegrations[0], project: 'old-project' }] })
  await provider.flush()
  assert.equal(provider.render({}, 'SettingProvider').props.value.state.azDoIntegrations[0].project, 'new-project')
})

test('grid startup cannot overwrite live table settings and removes listeners on unmount', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  let release
  view.api.invoke = (name) =>
    name === 'get-settings'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve(false)
  const props = { data: [{ id: 1, creationDate: new Date() }] }
  view.render(props)
  await view.flush()
  view.listeners.get('settings')({ ...settings, appearance: { ...settings.appearance, tableSize: 'medium' } })
  release({ ...settings, appearance: { ...settings.appearance, tableSize: 'extra-small' } })
  await view.flush()
  const grid = elements(view.render(props), (element) => element.type === 'DataGrid')[0]
  assert.equal(grid.props.size, 'medium')
  view.unmount()
  assert.equal(view.listenerCount('settings'), 0)
})

test('settings startup failure reaches the existing visible error field', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.api.invoke = async () => {
    throw new Error('Settings are unavailable')
  }
  provider.render({}, 'SettingProvider')
  await provider.flush()
  assert.equal(provider.render({}, 'SettingProvider').props.value.saveError, 'Settings are unavailable')
})

test('clipboard failures are displayed without losing the edited filter', async () => {
  for (const action of ['Copy filter', 'Paste filter']) {
    const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
    const changes = []
    view.setContext({
      state: { profiles: [{ ...profile, filter: 'draft filter' }] },
      actions: { onChangeHandler: (event) => changes.push(event) },
    })
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error('Clipboard unavailable')
          },
          readText: async () => {
            throw new Error('Clipboard unavailable')
          },
        },
      },
    })
    try {
      const button = elements(
        view.render(),
        (element) => element.type === 'Button' && element.props.children === action
      )[0]
      await button.props.onClick()
      await view.flush()
      assert.ok(elements(view.render(), (element) => element.props?.role === 'alert').length)
      assert.equal(changes.length, 0)
    } finally {
      Object.defineProperty(globalThis, 'navigator', originalNavigator)
    }
  }
})

test('failed update download stays visible with a retry action and closes release notes', async () => {
  const view = await component('app/components/update-notification/update-notification.component.tsx')
  view.render()
  await view.flush()
  view.listeners.get('update:state-changed')({ status: 'available', info: { version: '2.0.0' } })
  view.render()
  await view.flush()
  const invoke = view.api.invoke
  view.api.invoke = async (channel) => {
    if (channel === 'update:download-update') throw new Error('Download unavailable')
    return invoke(channel)
  }
  const download = elements(
    view.toasts.at(-1).content,
    (element) => element.type === 'Button' && element.props.children === 'Download update'
  )[0]
  await download.props.onClick()
  view.render()
  await view.flush()
  assert.equal(view.toasts.length, 1)
  assert.equal(view.toasts[0].options.intent, 'error')
  assert.ok(elements(view.toasts[0].content, (element) => element.props?.children === 'Retry download').length)
  assert.equal(elements(view.render(), (element) => element.type === 'Dialog')[0].props.open, false)
})

test('release notes date only the current release when its actual release date is available', async () => {
  const view = await component('app/components/update-notification/update-notification.component.tsx')
  view.render()
  await view.flush()
  view.listeners.get('update:state-changed')({
    status: 'available',
    info: {
      version: '2.0.0',
      releaseDate: '2026-10-30T10:00:00Z',
      releaseNotes: [
        { version: '2.0.0', note: 'Current release' },
        { version: '1.9.0', note: 'Historical release' },
      ],
    },
  })
  view.listeners.get('update:show-releaseNotes')()
  const dialog = elements(view.render(), (element) => element.type === 'Dialog')[0]
  const headings = elements(dialog, (element) => element.type === 'h2')
  const currentRelease = elements(headings[0], (element) => element.type === 'span')
  assert.equal(
    currentRelease[1].props.children.join(''),
    ` - ${new Date('2026-10-30T10:00:00Z').toLocaleDateString()}`
  )
  assert.equal(elements(headings[1], (element) => element.type === 'span').length, 1)
})

test('release notes omit a date when the release date is missing or invalid', async () => {
  for (const releaseDate of [undefined, 'not-a-date']) {
    const view = await component('app/components/update-notification/update-notification.component.tsx')
    view.render()
    await view.flush()
    view.listeners.get('update:state-changed')({
      status: 'available',
      info: { version: '2.0.0', releaseDate, releaseNotes: 'Undated release' },
    })
    view.listeners.get('update:show-releaseNotes')()
    const heading = elements(view.render(), (element) => element.type === 'h2')[0]
    assert.equal(elements(heading, (element) => element.type === 'span').length, 1)
  }
})

test('update startup snapshot cannot replace a newer ready event and subscriptions are cleaned up', async () => {
  const view = await component('app/components/update-notification/update-notification.component.tsx')
  let finishSnapshot
  view.api.invoke = () =>
    new Promise((resolve) => {
      finishSnapshot = resolve
    })
  view.render()
  await view.flush()
  view.listeners.get('update:state-changed')({ status: 'ready', info: { version: '2.0.0' } })
  finishSnapshot({ status: 'available', info: { version: '1.0.0' } })
  await view.flush()
  view.render()
  await view.flush()
  assert.ok(elements(view.toasts.at(-1).content, (element) => element.props?.children === 'Restart & update').length)
  view.unmount()
  assert.equal(view.listenerCount('update:state-changed'), 0)
  assert.equal(view.listenerCount('update:show-releaseNotes'), 0)
})

test('update reload restores a downloaded release and rapid activation only installs once', async () => {
  const view = await component('app/components/update-notification/update-notification.component.tsx')
  let finishInstall
  view.api.invoke = (channel) => {
    if (channel === 'update:get-state') return Promise.resolve({ status: 'ready', info: { version: '2.0.0' } })
    assert.equal(channel, 'update:install-update')
    view.calls.push([channel])
    return new Promise((resolve) => {
      finishInstall = resolve
    })
  }
  view.render()
  await view.flush()
  view.render()
  await view.flush()
  const install = elements(view.toasts[0].content, (element) => element.props?.children === 'Restart & update')[0]
  const first = install.props.onClick()
  await install.props.onClick()
  assert.equal(view.calls.length, 1)
  finishInstall()
  await first
})

test('persistent update stages intercept framework dismissal keys while available updates track dismissal', async () => {
  const view = await component('app/components/update-notification/update-notification.component.tsx')
  view.render()
  await view.flush()
  const info = { version: '2.0.0' }
  for (const status of ['downloading', 'ready', 'installing', 'error']) {
    view.listeners.get('update:state-changed')({ status, info, operation: 'download' })
    const toaster = elements(view.render(), (element) => element.type === 'Toaster')[0]
    for (const key of ['Escape', 'Delete']) {
      let prevented = false
      let stopped = false
      toaster.props.onKeyDownCapture({
        key,
        preventDefault() {
          prevented = true
        },
        stopPropagation() {
          stopped = true
        },
      })
      assert.equal(prevented && stopped, true)
    }
    await view.flush()
  }
  view.listeners.get('update:state-changed')({ status: 'available', info })
  view.render()
  await view.flush()
  view.toasts[0].options.onStatusChange(null, { status: 'dismissed' })
  view.render()
  await view.flush()
  view.listeners.get('update:state-changed')({ status: 'ready', info })
  view.render()
  await view.flush()
  assert.equal(view.toasts.length, 2, 'A dismissed toast must be recreated for the next update stage')
  assert.notEqual(
    view.toasts[0].options.toastId,
    view.toasts[1].options.toastId,
    'A departing toast must not block a new stage during its exit animation'
  )
})

test('titlebar update button restores availability from startup and starts a download', async () => {
  const view = await component('lib/window/components/Titlebar.tsx')
  view.setContext({ titlebar: { title: 'PullRequest-Manager' }, window: { platform: 'darwin' } })
  const invoke = view.api.invoke
  view.api.invoke = (channel) =>
    channel === 'update:get-state'
      ? Promise.resolve({ status: 'available', info: { version: '2.0.0' } })
      : invoke(channel)
  const updateButtons = () =>
    elements(
      view.render({}, 'Titlebar'),
      (element) => element.type === 'Button' && element.props.children === 'Update available'
    )
  assert.equal(updateButtons().length, 0)
  await view.flush()
  assert.equal(updateButtons().length, 1)
  assert.equal(updateButtons()[0].props.appearance, 'primary')
  await updateButtons()[0].props.onClick()
  assert.equal(view.calls.filter(([channel]) => channel === 'update:download-update').length, 1)
  view.listeners.get('update:state-changed')({ status: 'downloading', info: { version: '2.0.0' } })
  assert.equal(updateButtons().length, 0)
  view.unmount()
  assert.equal(view.listenerCount('update:state-changed'), 0)
  assert.equal(view.listenerCount('loading'), 0)
})

test('titlebar update availability ignores a stale snapshot after a newer download event', async () => {
  const view = await component('lib/window/components/Titlebar.tsx')
  view.setContext({ titlebar: { title: 'PullRequest-Manager' }, window: { platform: 'win32' } })
  let finishSnapshot
  view.api.invoke = () =>
    new Promise((resolve) => {
      finishSnapshot = resolve
    })
  view.render({}, 'Titlebar')
  await view.flush()
  view.listeners.get('update:state-changed')({ status: 'downloading', info: { version: '2.0.0' } })
  finishSnapshot({ status: 'available', info: { version: '2.0.0' } })
  await view.flush()
  assert.equal(
    elements(view.render({}, 'Titlebar'), (element) => element.props?.children === 'Update available').length,
    0
  )
})

test('window startup ignores completions from an earlier mount', async () => {
  const view = await component('lib/window/components/WindowContext.tsx')
  let release
  view.api.invoke = () =>
    new Promise((resolve) => {
      release = resolve
    })
  view.render({}, 'WindowContextProvider')
  await view.flush()
  view.unmount()
  view.api.invoke = async () => ({ platform: 'darwin' })
  view.render({}, 'WindowContextProvider')
  await view.flush()
  release({ platform: 'win32' })
  await view.flush()
  assert.equal(view.render({}, 'WindowContextProvider').props.value.window.platform, 'darwin')
})

test('window startup logs rejected loads without an unhandled rejection', async () => {
  const view = await component('lib/window/components/WindowContext.tsx')
  const failure = new Error('Window unavailable')
  view.api.invoke = async () => {
    throw failure
  }
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args)
  try {
    view.render({}, 'WindowContextProvider')
    await view.flush()
    assert.ok(errors.some((args) => args.includes(failure)))
  } finally {
    console.error = original
  }
})

test('settings received before startup select the current default without resetting later tab choices', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  let release
  const invoke = view.api.invoke
  view.api.invoke = (name, ...args) =>
    name === 'get-settings'
      ? new Promise((resolve) => {
          release = resolve
        })
      : invoke(name, ...args)
  view.render()
  await view.flush()
  const liveSettings = {
    ...settings,
    profiles: [
      { ...profile, id: 'one', isDefault: true },
      { ...profile, id: 'two' },
    ],
  }
  view.listeners.get('settings')(liveSettings)
  release(settings)
  await view.flush()
  let tabs = elements(view.render(), (element) => element.type === 'TabList')[0]
  assert.equal(tabs.props.selectedValue, 'one')
  tabs.props.onTabSelect(null, { value: 'two' })
  view.listeners.get('settings')(liveSettings)
  tabs = elements(view.render(), (element) => element.type === 'TabList')[0]
  assert.equal(tabs.props.selectedValue, 'two')
})

test('settings startup retains access diagnostics when PR events precede connection settings', async () => {
  for (const liveSettings of [false, true]) {
    const provider = await component('app/components/settings/provider/setting.provider.tsx')
    const initialSettings = Promise.withResolvers()
    const access = { features: { code: { status: 'denied', message: 'Access denied' } } }
    provider.api.invoke = async (channel) => {
      if (channel === 'get-settings') return initialSettings.promise
      if (channel === 'get-pr-data')
        return { items: [], error: null, integrations: [{ id: 'integration', name: 'Test', error: null, access }] }
    }
    provider.render({}, 'SettingProvider')
    await provider.flush()
    provider.listeners.get('pr-data')({
      items: [],
      error: null,
      integrations: [{ id: 'integration', name: 'Test', error: null, access }],
    })
    if (liveSettings) provider.listeners.get('settings')(settings)
    initialSettings.resolve(settings)
    await provider.flush()
    assert.equal(provider.render({}, 'SettingProvider').props.value.azDoAccess, access)
  }
})

test('overview initially selects a visible default or the first visible profile without relying on builtin All', async () => {
  for (const [profiles, expected] of [
    [
      [
        { ...profile, id: 'builtin:all', isDefault: true, visible: false },
        { ...profile, id: 'review' },
      ],
      'review',
    ],
    [[{ ...profile, id: 'review' }], 'review'],
    [
      [
        { ...profile, id: 'first' },
        { ...profile, id: 'default', isDefault: true },
      ],
      'default',
    ],
    [
      [
        { ...profile, id: 'hidden', isDefault: true, visible: false },
        { ...profile, id: 'first', isDefault: true },
        { ...profile, id: 'second', isDefault: true },
      ],
      'first',
    ],
  ]) {
    const view = await component('app/pages/pull-requests/pull-requests.tsx')
    view.setSettings({ ...settings, profiles })
    view.render()
    await view.flush()
    const tree = view.render()
    assert.equal(elements(tree, (element) => element.type === 'TabList')[0].props.selectedValue, expected)
    assert.equal(elements(tree, (element) => element.type?.name === 'PrList')[0]?.key, expected)
  }
})

test('live settings retain a visible choice and replace hidden or deleted selections in priority order', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  const all = { ...profile, id: 'builtin:all', isDefault: true }
  const review = { ...profile, id: 'review' }
  const fallback = { ...profile, id: 'fallback' }
  view.setSettings({ ...settings, profiles: [all, review, fallback] })
  view.render()
  await view.flush()
  elements(view.render(), (element) => element.type === 'TabList')[0].props.onTabSelect(null, { value: 'review' })
  for (const [profiles, expected] of [
    [[all, review, { ...fallback, isDefault: true }], 'review'],
    [[all, { ...review, visible: false }, fallback], 'builtin:all'],
    [[review, { ...fallback, isDefault: true }], 'fallback'],
    [[review], 'review'],
  ]) {
    view.listeners.get('settings')({ ...settings, profiles })
    const tree = view.render()
    assert.equal(elements(tree, (element) => element.type === 'TabList')[0].props.selectedValue, expected)
    assert.equal(elements(tree, (element) => element.type?.name === 'PrList')[0]?.key, expected)
  }
})

test('overview with hidden or deleted profiles offers profile management and recovers when a profile becomes visible', async () => {
  for (const profiles of [[], [{ ...profile, isDefault: true, visible: false }]]) {
    const view = await component('app/pages/pull-requests/pull-requests.tsx')
    view.setSettings({ ...settings, profiles: [{ ...profile, isDefault: true }] })
    view.render()
    await view.flush()
    view.listeners.get('settings')({ ...settings, profiles })
    const tree = view.render()
    assert.equal(elements(tree, (element) => element.type?.name === 'PrList').length, 0)
    const empty = elements(tree, (element) => element.type?.name === 'ZeroData')[0]
    assert.equal(empty?.props.primaryText, 'No visible profiles')
    assert.equal(empty.props.actionText, 'Manage profiles')
    assert.equal(empty.props.actionHref, profiles.length ? '/settings/profiles/test' : '/settings/profiles/new')
    const refresh = elements(tree, (element) => element.type === 'Button' && element.props.children === 'Refresh')[0]
    assert.ok(refresh, 'Refresh remains available with no visible profiles')
    assert.equal(refresh.props.disabled, false)
    assert.equal(elements(tree, (element) => element.type === 'TabList').length, 0)
    view.listeners.get('settings')({ ...settings, profiles: [profile] })
    assert.equal(elements(view.render(), (element) => element.type === 'TabList')[0].props.selectedValue, 'test')
  }
})

test('setting a default clears other defaults immutably and unrelated edits preserve them', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings({
    ...settings,
    profiles: [
      { ...profile, id: 'one', isDefault: true },
      { ...profile, id: 'two', isDefault: false },
      { ...profile, id: 'legacy', isDefault: true },
    ],
  })
  provider.render({}, 'SettingProvider')
  await provider.flush()
  let value = provider.render({}, 'SettingProvider').props.value
  const before = value.state
  for (const item of before.profiles) Object.freeze(item)
  value.actions.onChangeHandler({ profileId: 'two', target: { name: 'isDefault', value: true } })
  value = provider.render({}, 'SettingProvider').props.value
  assert.deepEqual(
    value.state.profiles.map((item) => item.isDefault),
    [false, true, false]
  )
  assert.deepEqual(
    before.profiles.map((item) => item.isDefault),
    [true, false, true]
  )
  const updated = value.state
  for (const item of updated.profiles) Object.freeze(item)
  value.actions.onChangeHandler({ profileId: 'two', target: { name: 'label', value: 'Renamed' } })
  value = provider.render({}, 'SettingProvider').props.value
  assert.deepEqual(
    value.state.profiles.map((item) => item.isDefault),
    [false, true, false]
  )
  assert.equal(updated.profiles[1].label, 'Test')
  value.actions.onChangeHandler({ profileId: 'two', target: { name: 'isDefault', value: false } })
  value = provider.render({}, 'SettingProvider').props.value
  assert.deepEqual(
    value.state.profiles.map((item) => item.isDefault),
    [false, false, false]
  )
})

test('duplicating a default profile preserves its settings but does not create another default', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings({ ...settings, profiles: [{ ...profile, isDefault: true, filter: { op: 'AND', filters: [] } }] })
  provider.render({}, 'SettingProvider')
  await provider.flush()
  let value = provider.render({}, 'SettingProvider').props.value
  value.actions.duplicateProfile('test')
  value = provider.render({}, 'SettingProvider').props.value
  assert.equal(value.state.profiles[0].isDefault, true)
  assert.equal(value.state.profiles[1].isDefault, false)
  assert.notEqual(value.state.profiles[1].id, 'test')
  assert.equal(value.state.profiles[1].visible, true)
  assert.equal(value.state.profiles[1].filter, value.state.profiles[0].filter)
  await value.actions.saveSettings()
  assert.deepEqual(
    provider.calls.find(([name]) => name === 'save-settings')[1].profiles.map((item) => item.isDefault),
    [true, false]
  )
})

test('profile creation returns IDs and opens the new draft without saving other edits', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings({ ...settings, profiles: [{ ...profile, isDefault: true }] })
  provider.render({}, 'SettingProvider')
  await provider.flush()
  let value = provider.render({}, 'SettingProvider').props.value
  value.actions.onChangeHandler({ profileId: 'test', target: { name: 'label', value: 'Unsaved source' } })
  const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
  view.setParams({ profileId: 'new' })
  for (const label of ['New empty profile', 'Duplicate']) {
    value = provider.render({}, 'SettingProvider').props.value
    view.setContext(value)
    const tree = view.render().type()
    elements(tree, (element) => element.type === 'Button' && element.props.children === label)[0].props.onClick()
    value = provider.render({}, 'SettingProvider').props.value
    const created = value.state.profiles.at(-1)
    assert.deepEqual(view.calls.at(-1), ['navigate', `/settings/profiles/${created.id}`])
    assert.equal(created.isDefault, false)
    assert.equal(value.state.profiles[0].label, 'Unsaved source')
    assert.equal(value.dirty, true)
    assert.equal(
      provider.calls.some(([name]) => name === 'save-settings'),
      false
    )
    if (label === 'Duplicate') assert.equal(created.label, 'Unsaved source (copy)')
  }
})

test('profile actions return their created IDs and missing duplicate sources leave the draft unchanged', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings(settings)
  provider.render({}, 'SettingProvider')
  await provider.flush()
  let value = provider.render({}, 'SettingProvider').props.value
  for (const action of [() => value.actions.addProfile(), () => value.actions.duplicateProfile('test')]) {
    const id = action()
    value = provider.render({}, 'SettingProvider').props.value
    assert.equal(typeof id, 'string')
    assert.equal(id, value.state.profiles.at(-1).id)
  }
  const before = value.state
  assert.equal(value.actions.duplicateProfile('missing'), undefined)
  assert.strictEqual(provider.render({}, 'SettingProvider').props.value.state, before)
})

test('confirmed profile deletion opens a remaining profile or the explicit new route and keeps the draft', async () => {
  for (const profiles of [[profile], [profile, { ...profile, id: 'remaining', label: 'Remaining' }]]) {
    const provider = await component('app/components/settings/provider/setting.provider.tsx')
    provider.setSettings({ ...settings, profiles })
    provider.render({}, 'SettingProvider')
    await provider.flush()
    let value = provider.render({}, 'SettingProvider').props.value
    value.actions.onChangeHandler({ target: { name: 'repositoriesRootDirectory', value: '/unsaved' } })
    value = provider.render({}, 'SettingProvider').props.value
    const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
    view.setContext(value)
    const tree = view.render()
    const deleteButton = elements(tree, (element) => element.type?.name === 'DeleteProfileButton')[0].type()
    assert.equal(view.calls.length, 0, 'Opening the confirmation does not navigate or delete')
    assert.equal(value.state.profiles.length, profiles.length)
    const confirmation = elements(
      deleteButton,
      (element) => element.type?.name === 'DeleteButtonPopOverContent'
    )[0].type()
    elements(confirmation, (element) => element.type === 'Button')[0].props.onClick()
    assert.deepEqual(view.calls.at(-1), ['navigate', `/settings/profiles/${profiles[1]?.id ?? 'new'}`])
    value = provider.render({}, 'SettingProvider').props.value
    assert.deepEqual(
      value.state.profiles.map((item) => item.id),
      profiles.slice(1).map((item) => item.id)
    )
    assert.equal(value.state.repositoriesRootDirectory, '/unsaved')
    assert.equal(value.dirty, true)
    assert.equal(
      provider.calls.some(([name]) => name === 'save-settings'),
      false
    )
  }
})


test('settings status follows successful snapshots through deferred saves, failures, and later edits', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  const view = await component('app/components/settings/settings.component.tsx')
  provider.setSettings(settings)
  provider.render({}, 'SettingProvider')
  await provider.flush()
  const value = () => provider.render({}, 'SettingProvider').props.value
  const status = () => {
    view.setContext(value())
    const content = elements(view.render(), (element) => element.props.mainContent)[0].props.mainContent
    const node = elements(content, (element) => element.props.role === 'status')[0]
    assert.ok(node, 'Save status stays visible in an accessible live region')
    assert.equal(node.props['aria-atomic'], true)
    return node.props.children
  }
  const edit = (name) => value().actions.updateIntegration('integration', { name })
  let finish
  let saves = 0
  const invoke = provider.api.invoke
  provider.api.invoke = (channel, ...args) => {
    if (channel !== 'save-settings') return invoke(channel, ...args)
    saves++
    return new Promise((resolve, reject) => { finish = { resolve, reject, model: args[0] } })
  }
  assert.equal(status(), 'Saved')
  edit('Submitted')
  assert.equal(status(), 'Unsaved changes')
  const action = value().actions.saveSettings
  const saving = action()
  await action()
  assert.equal(saves, 1, 'Repeated save action cannot start another pending write')
  assert.equal(status(), 'Saving settings')
  provider.listeners.get('settings')(finish.model)
  assert.equal(status(), 'Saving settings', 'Broadcast alone does not announce success')
  assert.equal(value().dirty, true, 'Broadcast does not advance the successful snapshot before completion')
  finish.resolve()
  await saving
  assert.equal(status(), 'Saved')
  edit('Later')
  assert.equal(status(), 'Unsaved changes')
  const failed = value().actions.saveSettings()
  assert.equal(status(), 'Saving settings')
  finish.reject(new Error('Synthetic save failure'))
  await failed
  assert.equal(status(), 'Unable to save settings. Unsaved changes.')
  assert.match(value().saveError, /Synthetic save failure/)
  const retry = value().actions.saveSettings()
  assert.equal(status(), 'Saving settings')
  edit('Edited while saving')
  provider.listeners.get('settings')(finish.model)
  finish.resolve()
  await retry
  assert.equal(value().state.azDoIntegrations[0].name, 'Edited while saving')
  assert.equal(status(), 'Unsaved changes')
  const finalSave = value().actions.saveSettings()
  finish.resolve()
  await finalSave
  assert.equal(status(), 'Saved', 'Successful completion marks its submitted snapshot without relying on a broadcast')
  const cleanFailure = value().actions.saveSettings()
  finish.reject(new Error('Synthetic clean save failure'))
  await cleanFailure
  assert.equal(value().dirty, false)
  assert.equal(status(), 'Unable to save settings.', 'Failed save of a clean form does not announce unsaved changes')
  edit('Next edit')
  assert.equal(status(), 'Unsaved changes')
})

test('integration removal requires confirmation, preserves canceled credentials, and saves only on request', async () => {
  for (const multiple of [false, true]) {
    const integrations = [{ ...settings.azDoIntegrations[0], name: 'Named connection', pat: 'synthetic-token' }]
    if (multiple) integrations.push({ ...integrations[0], id: 'remaining', name: 'Remaining' })
    const provider = await component('app/components/settings/provider/setting.provider.tsx')
    provider.setSettings({ ...settings, azDoIntegrations: integrations })
    const value = () => provider.render({}, 'SettingProvider').props.value
    value()
    await provider.flush()
    value().actions.updateIntegration('integration', { project: 'Unsaved project' })
    const before = structuredClone(value().state)
    const view = await component('app/components/settings/azdo/settings-azdo.component.tsx')
    view.setParams({ integrationId: 'integration' })
    const tree = () => {
      view.setContext(value())
      return view.render()
    }
    const button = (label) => elements(tree(), (node) => node.type === 'Button' && node.props.children === label)[0]
    button('Remove integration').props.onClick?.()
    assert.deepEqual(value().state, before, 'Opening confirmation must leave the entire draft intact')
    const dialog = () => elements(tree(), (node) => node.type === 'Dialog')[0]
    assert.equal(dialog().props.open, true)
    assert.ok(elements(tree(), (node) => node.type === 'DialogContent')[0].props.children.includes('Named connection'))
    button('Cancel').props.onClick()
    assert.equal(dialog().props.open, false)
    assert.deepEqual(value().state, before, 'Cancel retains the draft including credentials')
    assert.equal(view.calls.length, 0)
    button('Remove integration').props.onClick()
    dialog().props.onOpenChange(null, { open: false })
    assert.deepEqual(value().state, before, 'Escape/dismiss retains the draft too')
    button('Remove integration').props.onClick()
    button('Yes, remove integration').props.onClick()
    assert.deepEqual(
      value().state.azDoIntegrations.map((item) => item.id),
      multiple ? ['remaining'] : []
    )
    assert.equal(value().selectedIntegrationId, multiple ? 'remaining' : '')
    assert.deepEqual(view.calls.at(-1), [
      'navigate',
      multiple ? '/settings/integrations/remaining' : '/settings/integrations',
    ])
    assert.equal(value().dirty, true)
    assert.equal(
      provider.calls.some(([channel]) => channel === 'save-settings'),
      false
    )
    await value().actions.saveSettings()
    assert.deepEqual(
      provider.calls.find(([channel]) => channel === 'save-settings')[1].azDoIntegrations.map((item) => item.id),
      multiple ? ['remaining'] : []
    )
  }
})

test('filter example fills only blank drafts with a valid unsaved filter', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  provider.setSettings(settings)
  provider.render({}, 'SettingProvider')
  await provider.flush()
  const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
  for (const draft of ['', ' \n\t ', '{"op":"AND","filters":[]}', '{unfinished draft']) {
    let value = provider.render({}, 'SettingProvider').props.value
    value.actions.onChangeHandler({ profileId: 'test', target: { name: 'filter', value: draft } })
    value = provider.render({}, 'SettingProvider').props.value
    view.setContext(value)
    const button = elements(
      view.render(),
      (element) => element.type === 'Button' && element.props.children === 'Insert example'
    )[0]
    assert.ok(button, 'Filter example action exists')
    assert.equal(button.props.disabled, Boolean(draft.trim()))
    assert.equal(button.props['aria-describedby'], 'profile-filter-help')
    button.props.onClick()
    value = provider.render({}, 'SettingProvider').props.value
    if (draft.trim()) assert.equal(value.state.profiles[0].filter, draft)
    else {
      assert.deepEqual(JSON.parse(value.state.profiles[0].filter), { op: 'AND', filters: [{ isDraft: false }] })
      assert.equal(value.state.profiles[0].filterValid, true)
      assert.equal(value.dirty, true)
    }
  }
  assert.equal(
    provider.calls.some(([name]) => name === 'save-settings'),
    false
  )
})

test('filter help explains blank behavior and links to the existing filter documentation', async () => {
  const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
  view.setContext({ state: { profiles: [profile] }, actions: {} })
  const tree = view.render()
  const help = elements(tree, (element) => element.props?.id === 'profile-filter-help')[0]
  assert.ok(help, 'Filter help exists beside the editor')
  assert.match(help.props.children, /blank.*all pull requests/i)
  assert.match(help.props.children, /empty.*example/i)
  const link = elements(tree, (element) => element.type === 'Link')[0]
  assert.equal(
    link.props.href,
    'https://github.com/Meral-IT/PullRequest-Manager/blob/develop/README.md#profile-filters'
  )
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noreferrer')
})

test('PR details distinguish identical queues by organization, project, and number with full title tooltips', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  const title = 'Fix invoice rounding across multiple currencies and regional payment processing systems'
  const data = ['North', 'South'].map((organization) => ({
    id: 12,
    details: {
      label: title,
      number: 42,
      organization,
      project: 'Finance',
      repository: 'Billing',
      branch: 'refs/heads/feature',
      targetBranch: 'refs/heads/main',
    },
    urls: { web: `https://dev.azure.com/${organization}/Finance/_git/Billing/pullrequest/42` },
  }))
  const grid = elements(view.render({ data }), (element) => element.type === 'DataGrid')[0]
  const details = grid.props.columns.find((column) => column.columnId === 'details')
  for (const [index, organization] of ['North', 'South'].entries()) {
    const cell = details.renderCell(data[index])
    const layout = elements(cell, (element) => element.type === 'TableCellLayout')[0]
    assert.equal(layout.props.description, `${organization}/Finance · #42 · Billing · feature → main`)
    const tooltip = elements(cell, (element) => element.type === 'Tooltip')[0]
    assert.ok(tooltip.props.content.includes(title), 'Truncated titles remain readable in full')
    assert.ok(tooltip.props.content.includes(`${organization}/Finance`), 'Source remains available when details truncate')
    assert.ok(tooltip.props.content.includes('#42'), 'Use the display PR number rather than the internal id')
    assert.equal(tooltip.props.relationship, 'description')
  }
  const legacy = { ...data[0], details: { ...data[0].details, organization: undefined, project: undefined } }
  const legacyLayout = elements(details.renderCell(legacy), (element) => element.type === 'TableCellLayout')[0]
  assert.equal(legacyLayout.props.description, '#42 · Billing · feature → main')
})

test('PR title links open the intended URL and expose launch failures', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  view.setSettings(settings)
  const item = {
    id: 12,
    details: { label: 'Fix invoice', repository: 'Billing', branch: 'feature', targetBranch: 'main' },
    urls: { web: 'https://example.com/pr/12' },
  }
  const data = [item]
  const grid = elements(view.render({ data }), (element) => element.type === 'DataGrid')[0]
  const cell = grid.props.columns.find((column) => column.columnId === 'details').renderCell(item)
  const link = elements(cell, (element) => element.type === 'Link')[0]
  assert.ok(link, 'The PR title must be a semantic link')
  assert.equal(link.props.href, 'https://example.com/pr/12')
  assert.equal(link.props.children.props.children, 'Fix invoice')
  let prevented = false
  await link.props.onClick({
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.deepEqual(view.calls.at(-1), ['web-open-url', 'https://example.com/pr/12'])
  await view.flush()
  view.api.invoke = async () => {
    throw new Error('Browser launch failed. Try again.')
  }
  await link.props.onClick({ preventDefault: () => undefined })
  await view.flush()
  const alert = elements(view.render({ data }), (element) => element.props.role === 'alert')[0]
  assert.ok(elements(alert, (element) => element.props.children === 'Browser launch failed. Try again.').length)
})

test('visible row actions share approval and reset handlers and restore trigger focus', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  view.setSettings(settings)
  const data = [
    { id: 1, details: { label: 'First', repository: 'One' } },
    { id: 2, details: { label: 'Second', repository: 'Two' } },
  ]
  view.render({ data })
  await view.flush()
  const grid = () => elements(view.render({ data }), (element) => element.type === 'DataGrid')[0]
  const actions = grid().props.columns.find((column) => column.columnId === 'actions')
  assert.ok(actions, 'Each PR needs a visible actions control')
  let focused = 0
  const trigger = {
    focus() {
      focused++
    },
    getBoundingClientRect() {
      return {}
    },
  }
  const button = elements(actions.renderCell(data[1]), (element) => element.type === 'Button')[0]
  assert.equal(button.props['aria-label'], 'Actions for PR 2: Second')
  assert.equal(button.props.children, 'Actions')
  assert.equal(button.props['aria-haspopup'], 'menu')
  await button.props.onClick({ currentTarget: trigger, preventDefault: () => undefined })
  let tree = view.render({ data })
  let menu = elements(tree, (element) => element.type === 'Menu')[0]
  assert.equal(menu.props.open, true)
  elements(menu, (element) => element.type === 'MenuItem' && element.props.children === 'Approve')[0].props.onClick()
  assert.deepEqual(
    view.calls.find(([channel]) => channel === 'approve-prs'),
    ['approve-prs', [data[1]]]
  )
  assert.equal(focused, 1)
  await button.props.onClick({ currentTarget: trigger, preventDefault: () => undefined })
  tree = view.render({ data })
  menu = elements(tree, (element) => element.type === 'Menu')[0]
  elements(
    menu,
    (element) => element.type === 'MenuItem' && element.props.children === 'Reset feedback'
  )[0].props.onClick()
  assert.deepEqual(
    view.calls.find(([channel]) => channel === 'reset-pr-feedback'),
    ['reset-pr-feedback', data[1]]
  )
  await button.props.onClick({ currentTarget: trigger, preventDefault: () => undefined })
  menu = elements(view.render({ data }), (element) => element.type === 'Menu')[0]
  menu.props.onOpenChange(null, { open: false, keyboard: true, type: 'menuPopoverKeyDown', event: { key: 'Escape' } })
  assert.equal(focused, 3)
  const body = elements(view.render({ data }), (element) => element.type === 'DataGridBody')[0]
  const row = body.props.children({ item: data[0], rowId: 1 })
  let contextFocus = 0
  const origin = { focus: () => contextFocus++ }
  await row.props.onContextMenu({
    preventDefault: () => undefined,
    currentTarget: { focus: () => undefined },
    target: { closest: () => origin },
    clientX: 0,
    clientY: 0,
  })
  menu = elements(view.render({ data }), (element) => element.type === 'Menu')[0]
  menu.props.onOpenChange(null, { open: false, type: 'menuPopoverKeyDown' })
  assert.equal(contextFocus, 1, 'Context menu Escape returns to the originating link or cell')
  for (const columnId of ['details', 'actions', 'statusChecks']) {
    assert.equal(
      row.props.children({ columnId, renderCell: () => null }).props.focusMode,
      columnId === 'actions' ? 'none' : 'group'
    )
  }
})

test('visible bulk approval names its matching scope and uses the active profile filters', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  const profiles = [
    {
      ...profile,
      id: 'enabled',
      label: 'Review queue',
      isDefault: true,
      enableAcceptAll: true,
      filter: { op: 'AND', filters: [{ isDraft: false }] },
    },
    { ...profile, id: 'disabled', label: 'Read only' },
  ]
  const items = [
    {
      id: 1,
      isDraft: false,
      author: { id: 'ada', label: 'Ada' },
      details: { label: 'Invoice fix', repository: 'Billing', targetBranch: 'main' },
    },
    {
      id: 2,
      isDraft: false,
      author: { id: 'grace', label: 'Grace' },
      details: { label: 'Dashboard fix', repository: 'Portal', targetBranch: 'develop' },
    },
    {
      id: 3,
      isDraft: true,
      author: { id: 'ada', label: 'Ada' },
      details: { label: 'Invoice draft', repository: 'Billing', targetBranch: 'main' },
    },
  ]
  view.setSettings({ ...settings, profiles })
  const invoke = view.api.invoke
  view.api.invoke = (name, ...args) =>
    name === 'get-pr-data' ? Promise.resolve({ items, error: null }) : invoke(name, ...args)
  view.render()
  await view.flush()
  const bulk = () =>
    elements(
      view.render(),
      (element) => element.type === 'Button' && element.props['aria-label']?.includes('matching PRs in Review queue')
    )[0]
  assert.ok(bulk(), 'Bulk approval needs an explicit labeled trigger')
  assert.match(bulk().props['aria-label'], /matching PRs in Review queue \(2\)/)
  elements(
    view.render(),
    (element) => element.type === 'Button' && element.props['aria-controls'] === 'pr-filter-line'
  )[0].props.onClick()
  elements(view.render(), (element) => element.type === 'Input')[0].props.onChange(null, { value: 'invoice' })
  assert.match(bulk().props['aria-label'], /matching PRs in Review queue \(1\)/)
  bulk().props.onClick({ currentTarget: { focus: () => undefined } })
  elements(view.render(), (element) => element.type?.name === 'TabHeaderMenu')[0].props.onClick()
  assert.deepEqual(
    view.calls.find(([channel]) => channel === 'approve-prs'),
    ['approve-prs', [items[0]]]
  )
  elements(view.render(), (element) => element.type === 'Input')[0].props.onChange(null, { value: 'no matches' })
  assert.equal(bulk().props.disabled, true)
  elements(view.render(), (element) => element.type === 'TabList')[0].props.onTabSelect(null, { value: 'disabled' })
  assert.equal(bulk(), undefined)
})

function pageControl(tree, label) {
  return elements(tree, (element) => element.type === 'Button' && element.props['aria-label'] === label)[0]
}

const pagedPrs = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    creationDate: new Date(2026, 0, 1, 0, index),
    author: { id: 'author', label: 'Author' },
    details: {
      label: `PR ${String(count - index).padStart(5, '0')}`,
      repository: `repo-${index + 1}`,
      targetBranch: 'main',
    },
    reviewers: [],
    evaluations: [],
    urls: { web: `https://example.invalid/${index + 1}` },
  }))
const gridIn = (tree) => elements(tree, (element) => element.type === 'DataGrid')[0]

test('PR pagination bounds 101 and 10000 items, exposes ranges, and reaches the last page', async () => {
  for (const count of [101, 10000]) {
    const view = await component('app/components/pr-list/pr-list.tsx')
    view.setSettings(settings)
    const props = { data: pagedPrs(count) }
    let tree = view.render(props)
    await view.flush()
    tree = view.render(props)
    assert.equal(gridIn(tree).props.items.length, 100)
    assert.equal(gridIn(tree).props.items[0].id, count)
    assert.equal(pageControl(tree, 'Previous PR page').props.disabled, true)
    assert.equal(pageControl(tree, 'Next PR page').props.disabled, false)
    const range = () => elements(tree, (element) => element.props?.role === 'status')[0].props.children
    assert.equal(range(), `1–100 of ${count} PRs`)
    for (let page = 1; page < Math.ceil(count / 100); page++) {
      pageControl(tree, 'Next PR page').props.onClick()
      tree = view.render(props)
    }
    assert.equal(pageControl(tree, 'Next PR page').props.disabled, true)
    assert.equal(gridIn(tree).props.items.length, count % 100 || 100)
    assert.equal(gridIn(tree).props.items.at(-1).id, 1)
    assert.equal(range(), `${Math.floor((count - 1) / 100) * 100 + 1}–${count} of ${count} PRs`)
    pageControl(tree, 'Previous PR page').props.onClick()
    tree = view.render(props)
    assert.equal(gridIn(tree).props.items.length, 100)
  }
})

test('PR pages reset after filter shrink, refresh and saved/manual sorting changes', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  view.setSettings(settings)
  const data = pagedPrs(201)
  let props = { data, sorting: null }
  let tree = view.render(props)
  await view.flush()
  pageControl(tree, 'Next PR page').props.onClick()
  tree = view.render(props)
  assert.equal(gridIn(tree).props.items[0].id, 101)
  gridIn(tree).props.onSortChange(null, { sortColumn: 'details', sortDirection: 'ascending' })
  view.render(props)
  await view.flush()
  tree = view.render(props)
  assert.equal(gridIn(tree).props.items[0].id, 201, 'Manual sort must order the full set before slicing')
  pageControl(tree, 'Next PR page').props.onClick()
  tree = view.render(props)
  assert.equal(gridIn(tree).props.items[0].id, 101)
  props = { data: data.slice(0, 2), sorting: null }
  tree = view.render(props)
  assert.equal(gridIn(tree).props.items.length, 2, 'Shrinking a filter must never expose an empty stale page')
  await view.flush()
  tree = view.render(props)
  assert.equal(pageControl(tree, 'Next PR page'), undefined)
  props = { data: [...data], sorting: null }
  view.render(props)
  await view.flush()
  tree = view.render(props)
  assert.equal(gridIn(tree).props.items[0].id, 201)
  pageControl(tree, 'Next PR page').props.onClick()
  props = { data: props.data, sorting: { sortColumn: 'creationDate', sortDirection: 'ascending' } }
  view.render(props)
  await view.flush()
  tree = view.render(props)
  assert.equal(gridIn(tree).props.items[0].id, 1)
  assert.deepEqual(
    gridIn(tree).props.sortState,
    props.sorting,
    'Fluent must not reapply stale manual sorting to a saved page'
  )
})

test('later-page row actions keep their PR and repository targets', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  view.setSettings(settings)
  const invoke = view.api.invoke
  view.api.invoke = (name, ...args) =>
    name === 'check-vscode-installed' ? Promise.resolve(true) : invoke(name, ...args)
  const props = { data: pagedPrs(101), sorting: null }
  let tree = view.render(props)
  await view.flush()
  pageControl(tree, 'Next PR page').props.onClick()
  tree = view.render(props)
  const grid = gridIn(tree)
  const item = grid.props.items[0]
  const actions = grid.props.columns.find((column) => column.columnId === 'actions').renderCell(item)
  await actions.props.onClick({ preventDefault: () => undefined, currentTarget: { focus: () => undefined } })
  tree = view.render(props)
  const menuItem = (label) =>
    elements(tree, (element) => element.type === 'MenuItem' && element.props.children === label)[0]
  menuItem('Open in VSCode').props.onClick()
  assert.deepEqual(
    view.calls.find(([name]) => name === 'open-in-vscode'),
    ['open-in-vscode', 'repo-101']
  )
  await actions.props.onClick({ preventDefault: () => undefined, currentTarget: { focus: () => undefined } })
  tree = view.render(props)
  menuItem('Approve').props.onClick()
  assert.deepEqual(
    view.calls.find(([name]) => name === 'approve-prs'),
    ['approve-prs', [props.data[100]]]
  )
})

test('empty and single-page PR lists do not add pagination controls', async () => {
  for (const count of [0, 1, 100]) {
    const view = await component('app/components/pr-list/pr-list.tsx')
    const tree = view.render({ data: pagedPrs(count) })
    assert.equal(pageControl(tree, 'Previous PR page'), undefined)
    assert.equal(pageControl(tree, 'Next PR page'), undefined)
  }
})

test('creation sorting keeps equal and missing dates stable across page boundaries', async () => {
  for (const sortDirection of ['ascending', 'descending']) {
    const view = await component('app/components/pr-list/pr-list.tsx')
    view.setSettings(settings)
    const data = pagedPrs(102).map((item) => ({
      ...item,
      creationDate: item.id === 102 ? undefined : new Date(2026, 0, 1),
    }))
    const props = { data, sorting: { sortColumn: 'creationDate', sortDirection } }
    let tree = view.render(props)
    await view.flush()
    const first = gridIn(tree).props.items
    pageControl(tree, 'Next PR page').props.onClick()
    tree = view.render(props)
    const ids = [...first, ...gridIn(tree).props.items].map((item) => item.id)
    assert.deepEqual(
      ids,
      sortDirection === 'ascending' ? [102, ...data.slice(0, 101).map((item) => item.id)] : data.map((item) => item.id)
    )
  }
})

test('pending row approvals disable vote controls, suppress duplicate clicks, and announce partial outcomes', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  view.setSettings(settings)
  const props = { data: pagedPrs(3) }
  const invoke = view.api.invoke
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  view.api.invoke = (name, ...args) => {
    if (name === 'approve-prs') {
      view.calls.push([name, ...args])
      return waiting
    }
    return invoke(name, ...args)
  }
  view.render(props)
  await view.flush()
  const actions = () => gridIn(view.render(props)).props.columns.find((column) => column.columnId === 'actions')
  const trigger = elements(actions().renderCell(props.data[0]), (element) => element.type === 'Button')[0]
  await trigger.props.onClick({ currentTarget: { focus: () => undefined }, preventDefault: () => undefined })
  const voteItem = (tree, text) =>
    elements(tree, (element) => element.type === 'MenuItem' && element.props.children === text)[0]
  const approve = voteItem(view.render(props), 'Approve')
  approve.props.onClick()
  approve.props.onClick()
  assert.equal(
    view.calls.filter(([name]) => name === 'approve-prs').length,
    1,
    'Repeated clicks must not duplicate votes'
  )
  let tree = view.render(props)
  assert.equal(voteItem(tree, 'Approve').props.disabled, true)
  assert.equal(voteItem(tree, 'Reset feedback').props.disabled, true)
  release({
    succeeded: 1,
    skipped: 1,
    failed: 1,
    error: 'Access denied. Check PAT scopes and Azure DevOps permissions for this feature.',
  })
  await view.flush()
  tree = view.render(props)
  const notice = elements(tree, (element) => element.props.role === 'alert')[0]
  assert.ok(notice, 'Partial failures need an accessible outcome')
  assert.ok(
    elements(notice, (element) => /1 approved.*1 skipped.*1 failed/.test(String(element.props.children))).length
  )
  assert.equal(gridIn(tree).props.items.length, 3, 'Action failure must not hide healthy rows')
  assert.equal(voteItem(tree, 'Approve').props.disabled, false)
})

test('pending bulk approval prevents repeated actions and keeps healthy rows after a safe error', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  view.setSettings({ ...settings, profiles: [{ ...profile, isDefault: true, enableAcceptAll: true }] })
  const items = pagedPrs(2)
  const invoke = view.api.invoke
  let reject
  const waiting = new Promise((_resolve, failure) => {
    reject = failure
  })
  view.api.invoke = (name, ...args) => {
    if (name === 'get-pr-data') return Promise.resolve({ items, error: null })
    if (name === 'approve-prs') {
      view.calls.push([name, ...args])
      return waiting
    }
    return invoke(name, ...args)
  }
  view.render()
  await view.flush()
  const bulk = () =>
    elements(
      view.render(),
      (element) => element.type === 'Button' && element.props['aria-label']?.includes('matching PRs in Test')
    )[0]
  bulk().props.onClick({ currentTarget: { focus: () => undefined } })
  const approve = elements(view.render(), (element) => element.type?.name === 'TabHeaderMenu')[0]
  approve.props.onClick()
  approve.props.onClick()
  assert.equal(view.calls.filter(([name]) => name === 'approve-prs').length, 1)
  assert.equal(bulk().props.disabled, true)
  reject(new Error('PAT=test-token sensitive server response'))
  await view.flush()
  const tree = view.render()
  const notice = elements(tree, (element) => element.props.role === 'alert')[0]
  assert.ok(notice, 'Transport failure needs an accessible safe outcome')
  assert.equal(JSON.stringify(notice).includes('test-token'), false, 'Raw IPC errors must never reach action UI')
  assert.ok(elements(tree, (element) => element.type?.name === 'PrList' && element.props.data.length === 2).length)
  assert.equal(bulk().props.disabled, false)
})

test('row and bulk approval share pending state and keep outcomes when profiles change', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  view.setSettings({
    ...settings,
    profiles: [
      { ...profile, isDefault: true, enableAcceptAll: true },
      { ...profile, id: 'other', label: 'Other', enableAcceptAll: true },
    ],
  })
  const items = pagedPrs(1)
  const invoke = view.api.invoke
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  view.api.invoke = (name, ...args) => {
    if (name === 'get-pr-data') return Promise.resolve({ items, error: null })
    if (name === 'approve-prs') {
      view.calls.push([name, ...args])
      return pending
    }
    return invoke(name, ...args)
  }
  view.render()
  await view.flush()
  const row = () => elements(view.render(), (element) => element.type?.name === 'PrList')[0]
  const action = row().props.voteAction
  const voting = action.run('approve', items)
  action.run('reset', items)
  let tree = view.render()
  assert.equal(row().props.voteAction.pending, true)
  assert.equal(
    elements(
      tree,
      (element) => element.type === 'Button' && element.props['aria-label']?.includes('matching PRs in Test')
    )[0].props.disabled,
    true
  )
  elements(tree, (element) => element.type === 'TabList')[0].props.onTabSelect(null, { value: 'other' })
  assert.equal(row().props.voteAction.pending, true, 'Profile changes must not release pending votes')
  release({ succeeded: 0, skipped: 1, failed: 0 })
  await voting
  tree = view.render()
  assert.equal(view.calls.filter(([name]) => name === 'approve-prs').length, 1)
  assert.ok(
    elements(
      tree,
      (element) =>
        element.props.role === 'status' &&
        elements(element, (child) => /0 approved.*1 skipped.*0 failed/.test(String(child.props.children))).length
    ).length
  )
})

test('row reset announces a successful reset and safe denied outcome while retaining rows', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  view.setSettings(settings)
  const props = { data: pagedPrs(1) }
  view.render(props)
  await view.flush()
  const reset = async () => {
    const column = gridIn(view.render(props)).props.columns.find((column) => column.columnId === 'actions')
    const trigger = elements(column.renderCell(props.data[0]), (element) => element.type === 'Button')[0]
    await trigger.props.onClick({ currentTarget: { focus: () => undefined }, preventDefault: () => undefined })
    elements(
      view.render(props),
      (element) => element.type === 'MenuItem' && element.props.children === 'Reset feedback'
    )[0].props.onClick()
    await view.flush()
    return view.render(props)
  }
  let tree = await reset()
  assert.ok(
    elements(
      tree,
      (element) =>
        element.props.role === 'status' &&
        elements(element, (child) => /1 vote reset.*0 skipped.*0 failed/.test(String(child.props.children))).length
    ).length
  )
  const invoke = view.api.invoke
  view.api.invoke = (name, ...args) =>
    name === 'reset-pr-feedback'
      ? Promise.resolve({
          succeeded: 0,
          skipped: 0,
          failed: 1,
          error: 'Access denied. Check PAT scopes and Azure DevOps permissions for this feature.',
        })
      : invoke(name, ...args)
  tree = await reset()
  assert.ok(
    elements(
      tree,
      (element) =>
        element.props.role === 'alert' &&
        elements(element, (child) =>
          /0 votes reset.*0 skipped.*1 failed.*Access denied/.test(String(child.props.children))
        ).length
    ).length
  )
  assert.equal(gridIn(tree).props.items.length, 1)
})

test('overview exposes pending initial snapshot, refresh partial failure, retry, and real freshness', async () => {
  const view = await component('app/pages/pull-requests/pull-requests.tsx')
  view.setSettings(settings)
  const initial = Promise.withResolvers()
  const refreshes = []
  const invoke = view.api.invoke
  view.api.invoke = (channel, ...args) => {
    if (channel === 'get-pr-data') return initial.promise
    if (channel === 'update-pr-data') {
      const refresh = Promise.withResolvers()
      refreshes.push(refresh)
      return refresh.promise
    }
    return invoke(channel, ...args)
  }
  const button = (tree) =>
    elements(tree, (element) => element.type === 'Button' && element.props.children === 'Refresh')[0]
  const text = (tree) => JSON.stringify(tree, (_, value) => (typeof value === 'function' ? undefined : value))
  let tree = view.render()
  await view.flush()
  assert.ok(button(tree), 'Refresh is visible while initial data is pending')
  assert.equal(button(tree).props.disabled, true)
  assert.match(text(tree), /Loading pull requests/)
  assert.equal(elements(tree, (element) => element.type?.name === 'PrList').length, 0)
  initial.resolve({ items: [], error: null, isLoading: true })
  await view.flush()
  assert.equal(button(view.render()).props.disabled, true, 'snapshot retains an already running refresh')
  const timestamp = Date.now() - 60_000
  view.listeners.get('pr-data')({ items: [], error: null, lastSuccessfulRefreshAt: timestamp })
  view.listeners.get('loading')({ isLoading: false })
  tree = view.render()
  assert.equal(button(tree).props.disabled, false)
  assert.match(text(tree), /Last successful refresh/)
  const click = button(tree).props.onClick()
  await button(tree).props.onClick()
  assert.equal(refreshes.length, 1, 'duplicate calls are suppressed before a rerender')
  tree = view.render()
  assert.equal(button(tree).props.disabled, true)
  assert.match(text(tree), /Refreshing pull requests/)
  refreshes[0].resolve({
    items: [],
    error: null,
    lastSuccessfulRefreshAt: timestamp,
    integrations: [{ id: 'one', name: 'One', error: { message: 'Offline' } }],
  })
  await click
  tree = view.render()
  assert.equal(button(tree).props.disabled, false)
  assert.match(text(tree), /Refresh incomplete/)
  assert.match(text(tree), /Offline/)
  assert.ok(elements(tree, (element) => element.props?.role === 'status').length)
  const retry = button(tree).props.onClick()
  refreshes[1].resolve({ items: [], error: null, lastSuccessfulRefreshAt: timestamp + 1000 })
  await retry
  tree = view.render()
  assert.match(text(tree), /Refresh complete/)
  assert.doesNotMatch(text(tree), /Refresh incomplete/)
  const failed = button(tree).props.onClick()
  refreshes[2].reject(new Error('IPC unavailable'))
  await failed
  tree = view.render()
  assert.match(text(tree), /Refresh failed.*IPC unavailable/)
  assert.equal(button(tree).props.disabled, false)
  assert.match(text(tree), /Last successful refresh/)
  const staleRefresh = button(tree).props.onClick()
  view.listeners.get('pr-data')({
    items: [],
    error: null,
    integrations: [{ id: 'replacement', name: 'Replacement', error: { message: 'Current connection failed' } }],
  })
  refreshes[3].resolve({ items: [], error: null, lastSuccessfulRefreshAt: timestamp })
  await staleRefresh
  tree = view.render()
  assert.doesNotMatch(
    text(tree),
    /Last successful refresh/,
    'a late response cannot restore a replaced connection snapshot'
  )
  assert.match(text(tree), /Current connection failed/)
  view.unmount()
  assert.equal(view.listenerCount('loading'), 0)
})

test('titlebar restores running refresh from snapshot and ignores a stale loading snapshot', async () => {
  const view = await component('lib/window/components/Titlebar.tsx')
  view.setContext({ titlebar: { title: 'PullRequest-Manager' }, window: { platform: 'darwin' } })
  const invoke = view.api.invoke
  view.api.invoke = (channel) =>
    channel === 'get-pr-data' ? Promise.resolve({ items: [], error: null, isLoading: true }) : invoke(channel)
  view.render({}, 'Titlebar')
  await view.flush()
  assert.equal(elements(view.render({}, 'Titlebar'), (element) => element.type === 'Spinner').length, 1)
  view.unmount()
  const delayed = Promise.withResolvers()
  view.api.invoke = (channel) => (channel === 'get-pr-data' ? delayed.promise : invoke(channel))
  view.render({}, 'Titlebar')
  await view.flush()
  view.listeners.get('loading')({ isLoading: false })
  delayed.resolve({ items: [], error: null, isLoading: true })
  await view.flush()
  assert.equal(elements(view.render({}, 'Titlebar'), (element) => element.type === 'Spinner').length, 0)
})
