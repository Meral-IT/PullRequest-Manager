import Editor, { BeforeMount } from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { PR_FILTER_SCHEMA } from './pr-filter-schema'

const SCHEMA_URI = 'https://pullrequest-manager.local/profile-filter-schema.json'
const SCHEMA_PATH_PREFIX = 'pullrequest-manager:///profile-filter/'

const handleBeforeMount: BeforeMount = (monaco) => {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [
      {
        uri: SCHEMA_URI,
        fileMatch: [`${SCHEMA_PATH_PREFIX}*.json`],
        schema: PR_FILTER_SCHEMA,
      },
    ],
  })
}

function useMonacoTheme(): string {
  const [appTheme, setAppTheme] = useState<string>('system')
  const [osDark, setOsDark] = useState<boolean>(
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )

  useEffect(() => {
    globalThis.api.invoke('get-theme').then((t: string) => setAppTheme(t))
    const unsubTheme = globalThis.api.receive('theme-changed', (t: string) => setAppTheme(t))
    const unsubNative = globalThis.api.receive('nativeThemeChanged', () => {
      setOsDark(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
    })
    return () => {
      unsubTheme?.()
      unsubNative?.()
    }
  }, [])

  const isDark = appTheme === 'dark' || (appTheme === 'system' && osDark)
  return isDark ? 'vs-dark' : 'vs'
}

interface Props {
  profileId: string
  value?: string
  onChange: (value: string) => void
}

export default function ProfileFilterEditor({ profileId, value, onChange }: Readonly<Props>) {
  const monacoTheme = useMonacoTheme()
  const schemaPath = `${SCHEMA_PATH_PREFIX}${profileId}.json`

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <Editor
        height="100%"
        language="json"
        value={value ?? ''}
        theme={monacoTheme}
        path={schemaPath}
        beforeMount={handleBeforeMount}
        onChange={(val) => onChange(val ?? '')}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 2,
          lineNumbers: 'off',
          folding: true,
          automaticLayout: true,
        }}
      />
    </div>
  )
}
