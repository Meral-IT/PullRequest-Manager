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
  const effects = []
  const listeners = new Map()
  const calls = []
  const document = new EventTarget()
  let cursor = 0
  let context
  let settings
  const api = {
    invoke: async (name, ...args) => {
      calls.push([name, ...args])
      if (name === 'get-settings') return settings
      if (name === 'get-pr-data') return { error: null, items: [] }
      return false
    },
    receive: (name, callback) => {
      listeners.set(name, callback)
      return () => listeners.delete(name)
    },
  }
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [
        states[index],
        (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value
        },
      ]
    },
    useRef(value) {
      return hooks.useState({ current: value })[0]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      if (!states[index] || dependencies.some((value, i) => value !== states[index][i])) {
        effects.push(effect)
        states[index] = dependencies
      }
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
      if (name === 'react-router-dom') return { useParams: () => ({ profileId: 'test' }) }
      return load(name)
    },
    result,
    result.exports
  )

  return {
    api,
    calls,
    listeners,
    setContext: (value) => {
      context = value
    },
    setSettings: (value) => {
      settings = value
    },
    render(props = {}, name = 'default') {
      cursor = 0
      globalThis.api = api
      globalThis.document = document
      globalThis.localStorage = { getItem: () => null, setItem: () => undefined }
      return result.exports[name](props)
    },
    async flush() {
      effects.splice(0).forEach((effect) => effect())
      await Promise.resolve()
      await Promise.resolve()
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
  azDo: {},
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
      value.actions.onChangeHandler({ target: { name: 'azDoPat', value: 'unsaved-token' } })
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
    else if (replaceSavedSettings) provider.listeners.get('settings')({ ...settings, azDo: { project: 'replacement' } })
    else value.actions.onChangeHandler({ target: { name: 'azDoPat', value: 'replacement' } })
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
  initial.actions.onChangeHandler({ target: { name: 'azDoProject', value: 'updated-project' } })
  const updated = provider.render({}, 'SettingProvider').props.value
  assert.notStrictEqual(updated, initial)
  assert.equal(updated.state.azDoProject, 'updated-project')
  assert.strictEqual(provider.render({}, 'SettingProvider').props.value, updated)
})

test('AzDo connection status uses native output and retains validate, recheck, and loading labels', async () => {
  const view = await component('app/components/settings/azdo/settings-azdo.component.tsx')
  const context = { state: { azDoOrganizationUrl: '' }, actions: {}, validatingAzDo: false }
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
