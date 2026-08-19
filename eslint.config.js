import { builtinModules } from 'node:module'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.sprint', 'docs', 'client-next/vendor'] },
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
  // reach into server/src/adapters. See docs/design/architecture.md.
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
            // Node.js accepts builtins with or without the `node:` prefix; the
            // pattern below only catches the prefixed form, so list the bare
            // names too (Node's own registry, not hand-picked) to close that gap.
            ...builtinModules.map((name) => ({
              name,
              message: 'core must not import Node.js builtins (E0)',
            })),
          ],
          patterns: [
            {
              group: ['**/server/**', '**/src/**', '**/adapters/**', '@hono/*'],
              message: 'core cannot import server / src / adapters (E0)',
            },
            {
              group: ['node:*'],
              message: 'core must not import Node.js builtins (E0)',
            },
          ],
        },
      ],
    },
  },
)
