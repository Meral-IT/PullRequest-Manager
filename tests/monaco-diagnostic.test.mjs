import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { installMonacoDiagnostic } from './monaco-diagnostic.mjs'

function fixture(nativeInput = true) {
  const records = []
  const host = new EventTarget()
  const native = Object.assign(new EventTarget(), { text: '{"fi', selectionStart: 4, selectionEnd: 4 })
  const input = {
    tagName: nativeInput ? 'DIV' : 'TEXTAREA',
    className: 'native-edit-context',
    editContext: nativeInput ? native : null,
    value: '{"fi',
    selectionStart: 4,
    selectionEnd: 4,
    closest: () => host,
  }
  let widget = null
  const subscriptions = new Map()
  const editor = {
    getDomNode: () => host,
    hasTextFocus: () => true,
    getValue: () => '{"fi',
    getSelection: () => ({ startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 5 }),
    getAction: () => ({ isSupported: () => true }),
  }
  for (const method of ['onDidChangeModelContent', 'onDidChangeCursorSelection']) {
    editor[method] = (callback) => {
      subscriptions.set(method, callback)
      return { dispose: () => subscriptions.delete(method) }
    }
  }
  host.querySelector = (selector) => (selector === '.suggest-widget' ? widget : { textContent: '{"fi' })
  const observers = []
  const context = vm.createContext({
    document: { querySelector: () => input, hasFocus: () => true, activeElement: input },
    performance: { now: () => 100, getEntriesByType: () => [{ name: 'file:///assets/jsonMode-hash.js' }] },
    monaco: { editor: { getEditors: () => [editor] } },
    console: { info: (message) => records.push(JSON.parse(message.slice('[monaco-diagnostic] '.length))) },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        observers.push(this)
      }
      observe() {
        this.connected = true
      }
      disconnect() {
        this.connected = false
      }
    },
  })
  vm.runInContext(`(${installMonacoDiagnostic.toString()})()`, context)
  return {
    context,
    input,
    host,
    native,
    records,
    subscriptions,
    observer: observers[0],
    setWidget: (value) => {
      widget = value
    },
  }
}

test('Monaco diagnostics capture actual synthetic editor/native/provider state and remove observers', () => {
  const f = fixture()
  assert.equal(f.records[0].modelText, '{"fi')
  assert.deepEqual(f.records[0].native, { text: '{"fi', selectionStart: 4, selectionEnd: 4 })
  assert.equal(f.records[0].selection.startColumn, 5)
  assert.equal(f.records[0].completionSupported, true)
  assert.equal(f.records[0].jsonModuleLoaded, true)
  f.host.dispatchEvent(Object.assign(new Event('keydown'), { key: ' ', code: 'Space', ctrlKey: true }))
  assert.equal(f.records.at(-1).key, ' ')
  assert.equal(f.records.at(-1).ctrl, true)
  f.native.dispatchEvent(
    Object.assign(new Event('textupdate'), {
      updateRangeStart: 0,
      updateRangeEnd: 10,
      text: '{"fi',
      selectionStart: 4,
      selectionEnd: 4,
    })
  )
  assert.equal(f.records.at(-1).updateRangeEnd, 10)
  f.setWidget({ className: 'suggest-widget visible', textContent: 'Loading...', querySelectorAll: () => [] })
  f.observer.callback()
  assert.equal(f.records.at(-1).widget.text, 'Loading...')
  f.context.smokeMonacoDiagnostic.mark('completion-wait')
  f.context.smokeMonacoDiagnostic.mark('completion-wait')
  assert.equal(f.records.filter((record) => record.event === 'completion-wait').length, 1)
  f.context.smokeMonacoDiagnostic.stop()
  assert.equal(f.records.at(-1).event, 'completion-accepted')
  assert.equal(f.subscriptions.size, 0)
  assert.equal(f.observer.connected, false)
  assert.equal(f.context.smokeMonacoDiagnostic, undefined)
  const count = f.records.length
  f.host.dispatchEvent(new Event('keydown'))
  f.native.dispatchEvent(new Event('textupdate'))
  assert.equal(f.records.length, count)
})

test('Monaco diagnostics bound event count and text, preserve final state, and support textarea input', () => {
  const f = fixture(false)
  f.input.value = 'x'.repeat(1000)
  for (let i = 0; i < 100; i++) f.host.dispatchEvent(new Event('input'))
  assert.equal(f.records.length, 48)
  assert.equal(f.records.at(-1).textarea.text.length, 512)
  assert.equal(f.records.at(-1).native, null)
  f.context.smokeMonacoDiagnostic.stop()
  assert.equal(f.records.length, 49)
  assert.equal(f.records.at(-1).event, 'completion-accepted')
})
