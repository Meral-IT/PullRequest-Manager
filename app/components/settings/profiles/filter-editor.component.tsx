import { useEffect, useEffectEvent, useRef, useState } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/features/register.all'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker&inline'
import { jsonDefaults } from 'monaco-editor/languages/features/json/register'
import { profileFilterSchema } from '@/lib/models/profile-filter.schema'

self.MonacoEnvironment = {
  getWorker: (_workerId, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
}

jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  comments: 'error',
  trailingCommas: 'error',
  schemaValidation: 'error',
  enableSchemaRequest: false,
  schemas: [
    {
      uri: profileFilterSchema.$id!,
      fileMatch: ['inmemory://profiles/*.json'],
      schema: profileFilterSchema,
    },
  ],
})

interface Props {
  profileId: string
  value: string
  theme: 'system' | 'light' | 'dark'
  className?: string
  onChange: (value: string) => void
}

export default function FilterEditor({ profileId, value, theme, className, onChange }: Readonly<Props>) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onContentChange = useEffectEvent(onChange)
  const getCurrentValue = useEffectEvent(() => value)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const preference = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const model = monaco.editor.createModel(
      getCurrentValue(),
      'json',
      monaco.Uri.parse(`inmemory://profiles/${encodeURIComponent(profileId)}.json`)
    )
    const instance = monaco.editor.create(container.current!, {
      model,
      ariaLabel: 'Profile filter JSON editor',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      tabFocusMode: true,
      wordWrap: 'on',
    })
    editor.current = instance
    const subscription = instance.onDidChangeModelContent(() => onContentChange(model.getValue()))
    return () => {
      subscription.dispose()
      instance.dispose()
      model.dispose()
      editor.current = null
    }
  }, [profileId])

  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (model && model.getValue() !== value) {
      instance!.executeEdits('paste-filter', [{ range: model.getFullModelRange(), text: value }])
    }
  }, [value, profileId])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' || (theme === 'system' && systemDark) ? 'vs-dark' : 'vs')
  }, [theme, systemDark])

  return <div className={className} ref={container} />
}
