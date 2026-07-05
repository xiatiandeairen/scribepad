import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.sprint', 'docs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  // E0: the portable core must stay framework-free so it can be imported into the
  // PM project without scribepad's server/client. Bars hono/react/execa and any
  // reach into server/src/adapters. See docs/architecture.md.
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'hono', message: 'core must stay framework-free (E0)' },
            { name: 'react', message: 'core must stay framework-free (E0)' },
            { name: 'react-dom', message: 'core must stay framework-free (E0)' },
            { name: 'execa', message: 'execa belongs in adapters/llm-execa, not core (E0)' },
          ],
          patterns: [
            {
              group: ['**/server/**', '**/src/**', '**/adapters/**', '@hono/*'],
              message: 'core cannot import server / src / adapters (E0)',
            },
          ],
        },
      ],
    },
  },
)
