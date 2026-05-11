import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const lensManifestPlugin = require('./eslint-rules/lens-manifest.js');

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/triple-slash-reference': 'off', // Next.js auto-generates these references
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'off',
      // Auth bypass prevention — do not pass client-supplied user IDs to server mutations
      'no-restricted-syntax': [
        'warn',
        {
          selector: "Property[key.name='userId'][value.type='MemberExpression'][value.object.name='body']",
          message: "Sending body.userId to a mutation may enable server-side auth bypass. Ensure the server uses req.user.id instead.",
        },
      ],
    },
  },
  // Lens-page contract: every app/lenses/<id>/page.tsx must mount LensShell
  // with a matching lensId. lens-id-is-known stays 'warn' until all 200+
  // lens manifests are registered.
  {
    files: ['app/lenses/**/page.tsx'],
    plugins: { lensManifest: lensManifestPlugin },
    rules: {
      'lensManifest/lens-shell-id-matches-path': 'error',
      'lensManifest/lens-page-uses-shell': 'warn',
      'lensManifest/lens-id-is-known': ['warn', { rootDir: __dirname }],
    },
  },
  {
    ignores: ['node_modules/', '.next/', 'out/', 'dist/', 'build/', 'coverage/', '*.min.js'],
  },
];

export default eslintConfig;
