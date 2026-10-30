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
            dismissToast: () => undefined,
            updateToast: () => undefined,
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
      if (name.startsWith('@fluentui/')) return fluent
      if (name === 'react-router-dom')
        return {
          useParams: () => params,
          useLocation: () => ({ pathname }),
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
  secondTab.props.onContextMenu({ preventDefault: () => undefined, currentTarget: {} })
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

test('failed update installation replaces progress with an error toast', async () => {
  const view = await component('app/components/update-notification/update-notification.component.tsx')
  view.api.invoke = async () => {
    throw new Error('Download unavailable')
  }
  const tree = view.render()
  const install = elements(
    tree,
    (element) => element.type === 'Button' && element.props.children === 'Restart & Update'
  )[0]
  await install.props.onClick()
  await view.flush()
  assert.ok(view.toasts.some(({ options }) => options.intent === 'error'))
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
