import tseslint from '@electron-toolkit/eslint-config-ts'
import prettier from 'eslint-config-prettier/flat'
import react from 'eslint-plugin-react-x'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'temp/**'] },
  tseslint.configs.recommended,
  {
    ...react.configs['recommended-typescript'],
    files: ['**/*.tsx'],
    rules: {
      ...react.configs['recommended-typescript'].rules,
      'react-x/no-context-provider': 'off',
      'react-x/no-use-context': 'off',
      'react-x/set-state-in-effect': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  prettier
)
