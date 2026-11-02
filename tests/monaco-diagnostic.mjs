// Runs in the smoke renderer; keep diagnostics restricted to its synthetic filter editor.
export function installMonacoDiagnostic() {
  const input = document.querySelector('.monaco-editor [aria-label="Profile filter JSON editor"]')
  const host = input.closest('.monaco-editor')
  const editor = globalThis.monaco?.editor.getEditors().find((editor) => editor.getDomNode() === host)
  const started = performance.now()
  const cleanups = []
  const marks = new Set()
  let remaining = 48
  const snapshot = () => {
    const native = input.editContext
    const widget = host.querySelector('.suggest-widget')
    return {
      documentFocus: document.hasFocus(),
      activeElement: { tag: document.activeElement?.tagName, class: document.activeElement?.className },
      editorAvailable: !!editor,
      editorFocus: editor?.hasTextFocus(),
      modelText: editor?.getValue().slice(0, 512),
      selection: editor?.getSelection(),
      // This action requires a completion provider, a writable editor, and a hidden widget.
      completionSupported: editor?.getAction('editor.action.triggerSuggest')?.isSupported(),
      native: native
        ? {
            text: native.text.slice(0, 512),
            selectionStart: native.selectionStart,
            selectionEnd: native.selectionEnd,
          }
        : null,
      textarea:
        input.tagName === 'TEXTAREA'
          ? {
              text: input.value.slice(0, 512),
              selectionStart: input.selectionStart,
              selectionEnd: input.selectionEnd,
            }
          : null,
      renderedText: host.querySelector('.view-lines')?.textContent.slice(0, 512),
      widget: widget
        ? {
            class: widget.className,
            text: widget.textContent.slice(0, 256),
            rows: Array.from(widget.querySelectorAll('.monaco-list-row'))
              .slice(0, 8)
              .map((row) => row.textContent.slice(0, 80)),
          }
        : null,
      jsonModuleLoaded: performance.getEntriesByType('resource').some((entry) => /jsonMode[^/]*\.js/.test(entry.name)),
    }
  }
  const record = (event, detail = {}) => {
    if (remaining-- <= 0) return
    console.info(
      '[monaco-diagnostic] ' +
        JSON.stringify({
          event,
          stepElapsedMs: Math.round(performance.now() - started),
          ...detail,
          ...snapshot(),
        })
    )
  }
  const listen = (target, type, listener) => {
    const options = { capture: true, passive: true }
    target.addEventListener(type, listener, options)
    cleanups.push(() => target.removeEventListener(type, listener, options))
  }
  for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'focusin', 'focusout']) {
    listen(host, type, (event) =>
      record(type, {
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey,
        inputType: event.inputType,
        data: event.data?.slice(0, 80),
      })
    )
  }
  if (input.editContext)
    listen(input.editContext, 'textupdate', (event) =>
      record('textupdate', {
        updateRangeStart: event.updateRangeStart,
        updateRangeEnd: event.updateRangeEnd,
        text: event.text.slice(0, 80),
        selectionStart: event.selectionStart,
        selectionEnd: event.selectionEnd,
      })
    )
  if (editor) {
    for (const [subscribe, event] of [
      ['onDidChangeModelContent', 'model-content'],
      ['onDidChangeCursorSelection', 'model-selection'],
    ]) {
      const subscription = editor[subscribe](() => record(event))
      cleanups.push(() => subscription.dispose())
    }
  }
  let lastWidget
  const observer = new MutationObserver(() => {
    const widget = JSON.stringify(snapshot().widget)
    if (widget !== lastWidget) {
      lastWidget = widget
      record('widget-change')
    }
  })
  observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true })
  cleanups.push(() => observer.disconnect())
  globalThis.smokeMonacoDiagnostic = {
    mark(event) {
      if (!marks.has(event)) {
        marks.add(event)
        record(event)
      }
    },
    stop() {
      // Reserve a final state even when noisy rendering exhausts the event budget.
      remaining = 1
      record('completion-accepted')
      cleanups.forEach((cleanup) => cleanup())
      delete globalThis.smokeMonacoDiagnostic
    },
  }
  record('installed')
}
