import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const lensManifestPlugin = require('./eslint-rules/lens-manifest.js');

// eslint-config-next@16 ships native ESLint 9 flat-config arrays (each entry
// already has real `plugins: {react: <object>}` mappings, not legacy string
// plugin names) — spread them directly. The old `FlatCompat.extends('next/
// core-web-vitals', 'next/typescript')` pattern was for pre-16
// eslint-config-next, which shipped legacy .eslintrc-shaped shareable
// configs under those names; routing an already-flat config through
// FlatCompat's legacy ajv schema validator produced a bogus "circular
// structure" crash (the validator tried to JSON.stringify a plugin object
// that self-references its own config, e.g. eslint-plugin-react's
// `configs.recommended.plugins.react === <itself>`) instead of the real
// error.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/triple-slash-reference': 'off', // Next.js auto-generates these references
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'off',
      // eslint-plugin-react-hooks v7 (pulled in transitively by the
      // eslint-config-next@16 bump) ships the new React Compiler rule set
      // — set-state-in-effect/refs/purity/immutability/
      // preserve-manual-memoization/static-components/set-state-in-render/
      // globals — as hard errors in the 'recommended' config this repo
      // extends. None of these were part of this codebase's lint contract
      // before the bump, and they flag ~2,400 pre-existing call sites
      // (mostly the extremely common "hydrate state from localStorage in a
      // mount effect" idiom under set-state-in-effect alone). Downgraded to
      // 'warn', matching this file's existing precedent for
      // exhaustive-deps/no-explicit-any, rather than silently disabled —
      // visible in `npm run lint` output as a real, trackable backlog for a
      // dedicated follow-up pass, not swept under the rug.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/globals': 'warn',
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
    ignores: ['node_modules/', '.next/', 'out/', 'dist/', 'build/', 'coverage/', '*.min.js', 'public/unity-client/Build/'],
  },
  {
    files: ['server-proxy.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
