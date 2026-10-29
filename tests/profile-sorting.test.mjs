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
  for (const id of ['D:/a/project/context.ts', 'D:\\a\\project\\context.ts', '/project/context.ts', '../context.ts', '@/lib/context.ts']) {
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
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
      }]
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
    useMemo: (factory) => factory(),
    useContext: () => context,
  }
  const fluent = new Proxy({}, {
    get: (_, name) => {
      if (name === 'tokens') return {}
      if (name === 'makeStyles') return () => () => ({})
      if (name === 'makeResetStyles') return () => () => ''
      if (name === 'createTableColumn') return (column) => column
      return name
    },
  })
  const { output } = await build({
    input: resolve(__dirname, '..', entry),
    write: false,
    output: { format: 'cjs', exports: 'named' },
    platform: 'node',
    transform: { jsx: 'react-jsx' },
    external: isExternal,
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
  new Function('require', 'module', 'exports', output[0].code)((name) => {
    if (name === 'react') return hooks
    if (name.startsWith('@fluentui/')) return fluent
    if (name === 'react-router-dom') return { useParams: () => ({ profileId: 'test' }) }
    return load(name)
  }, result, result.exports)

  return {
    calls,
    listeners,
    setContext: (value) => { context = value },
    setSettings: (value) => { settings = value },
    render(props = {}, name = 'default') {
      cursor = 0
      globalThis.api = api
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
  id: 'test', label: 'Test', visible: true, enableAcceptAll: false, notifyOnNewPrs: false,
}
const settings = {
  general: {}, azDo: {}, appearance: { tableSize: 'small', theme: 'system' }, profiles: [profile],
}

test('profile sorting survives load, duplication, save, and removal; old profiles stay unsorted', async () => {
  const provider = await component('app/components/settings/provider/setting.provider.tsx')
  const sorting = { sortColumn: 'details', sortDirection: 'descending' }
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
  value.actions.onChangeHandler({ profileId: profile.id, target: { name: 'sorting', value: undefined } })
  value = provider.render({}, 'SettingProvider').props.value
  assert.equal(value.state.profiles[0].sorting, undefined)
  await value.actions.saveSettings()
  const saves = provider.calls.filter(([name]) => name === 'save-settings')
  assert.equal(JSON.parse(JSON.stringify(saves.at(-1)[1])).profiles[0].sorting, undefined)
  provider.listeners.get('settings')(settings)
  value = provider.render({}, 'SettingProvider').props.value
  assert.equal(value.state.profiles[0].sorting, undefined)
})

test('profile controls select and clear sorting and disable the unused direction', async () => {
  const view = await component('app/components/settings/profiles/settings-profiles.component.tsx')
  const changes = []
  const render = (sorting) => {
    view.setContext({ state: { profiles: [{ ...profile, sorting }] }, actions: { onChangeHandler: (event) => changes.push(event) } })
    return elements(view.render(), (element) => element.type === 'Select')
  }
  let selects = render(undefined)
  assert.equal(selects.length, 2)
  assert.equal(selects[1].props.disabled, true)
  selects[0].props.onChange({ target: { value: 'details' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'details', sortDirection: 'ascending' })
  selects = render({ sortColumn: 'details', sortDirection: 'ascending' })
  selects[1].props.onChange({ target: { value: 'descending' } })
  assert.deepEqual(changes.at(-1).target.value, { sortColumn: 'details', sortDirection: 'descending' })
  selects[0].props.onChange({ target: { value: '' } })
  assert.equal(changes.at(-1).target.value, undefined)
})

test('grid applies both sort directions to each supported column and prevents manual changes', async () => {
  const view = await component('app/components/pr-list/pr-list.tsx')
  const data = [
    { id: 1, author: { label: 'Zoe' }, details: { label: 'Zulu' }, reviewers: [1, 2], evaluations: [{ status: 3 }] },
    { id: 2, author: { label: 'Ada' }, details: { label: 'Alpha' }, reviewers: [], evaluations: [] },
  ]
  const grid = (sorting) => elements(view.render({ data, sorting }), (element) => element.type === 'DataGrid')[0]
  assert.equal(grid(undefined).props.sortable, true)
  for (const sortColumn of ['author', 'details', 'reviewers', 'statusChecks']) {
    for (const sortDirection of ['ascending', 'descending']) {
      const sorting = { sortColumn, sortDirection }
      const props = grid(sorting).props
      assert.deepEqual(props.items.map((pr) => pr.id), sortDirection === 'ascending' ? [2, 1] : [1, 2])
      assert.equal(props.sortable, false)
    }
  }
  assert.deepEqual(data.map((pr) => pr.id), [1, 2])
  assert.equal(grid(undefined).props.sortable, true)
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
