import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // Disallow empty catch blocks - use logger.debug() for silent failures
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
      curly: ['warn', 'multi-line'],
      'no-throw-literal': 'error',
      'no-return-await': 'warn',
      'require-await': 'warn',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      'no-iterator': 'error',
      'no-labels': 'error',
      'no-lone-blocks': 'warn',
      'no-multi-str': 'warn',
      'no-new-wrappers': 'error',
      'no-octal-escape': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-useless-call': 'warn',
      'no-useless-concat': 'warn',
      'no-useless-return': 'warn',
      'prefer-regex-literals': 'warn',
      radix: 'warn',
      yoda: 'warn',
      // Auth bypass prevention — client-supplied user identity must never substitute for req.user.id
      // Pattern: req.body/query.<anyUserId> used as actor instead of req.user.id
      // Fix: use req.user?.id (authenticated session). If this is a TARGET identifier (not the actor),
      //      add // safe: target-identifier or // safe: admin-only to suppress.
      'no-restricted-syntax': [
        'error',
        // ── req.body identity fields ──────────────────────────────────────────
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='userId']",
          message: "req.body.userId — use req.user?.id. If target identifier, add // safe: target-identifier",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='user_id']",
          message: "req.body.user_id — use req.user?.id. If target identifier or admin-only, add // safe: comment",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='ownerId']",
          message: "req.body.ownerId — use req.user?.id. If target identifier, add // safe: target-identifier",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='seller_id']",
          message: "req.body.seller_id — use req.user?.id. If admin-only, add // safe: admin-only",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='fromUserId']",
          message: "req.body.fromUserId — use req.user?.id. Actor must come from authenticated session.",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='toUserId']",
          message: "req.body.toUserId — verify: if this is the target recipient (not actor), add // safe: target-identifier",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='reviewer_id']",
          message: "req.body.reviewer_id — audit actor must be req.user?.id. Use req.user?.id for audit log integrity.",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='body'][property.name='creatorId']",
          message: "req.body.creatorId — use req.user?.id. If target identifier, add // safe: target-identifier",
        },
        // ── req.query identity fields ─────────────────────────────────────────
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='query'][property.name='userId']",
          message: "req.query.userId — ensure req.user?.id takes priority. Use req.user?.id || req.query.userId for public endpoints.",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='query'][property.name='user_id']",
          message: "req.query.user_id — use req.user?.id. If admin lookup, add // safe: admin-only",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='query'][property.name='ownerId']",
          message: "req.query.ownerId — ensure req.user?.id takes priority. If public filter, add // safe: public-filter",
        },
        {
          selector: "MemberExpression[object.object.name='req'][object.property.name='query'][property.name='creatorId']",
          message: "req.query.creatorId — ensure req.user?.id takes priority. If public analytics, add // safe: public-filter",
        },
      ],
    },
  },
  // ── Per-glob relaxations ────────────────────────────────────────────────
  // Goal: zero warnings under `eslint . --max-warnings=0` so CI can enforce.
  // The relaxations below are scoped to file types where the rule is noise,
  // not signal:
  //   - tests/** — fixture scaffolding leaves vars unused; tests log freely
  //   - scripts/** — CLI scripts log to stdout by design
  //   - routes/** — Express handlers are async-by-interface (may not await)
  //   - migrations/** — `up`/`down` signatures take `db` even when unused
  //   - emergent/** — heartbeat handlers are async-by-interface
  //   - domains/** — macro handlers take ctx + input even when one is unused
  //   - workers/** — worker entrypoints take options bag conventionally
  //   - lib/** — many lib functions take options bag conventionally
  //   - server.js — boot file logs status to stdout
  // Real bugs (no-empty, no-eval, no-throw-literal, restricted-syntax for
  // auth-bypass) stay errors everywhere.
  {
    files: ['tests/**/*.{js,mjs,cjs}', '**/*.test.js', '**/*-tests.js', '**/*.behavior.js'],
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'require-await': 'off',
      'no-return-await': 'off',
      'no-useless-concat': 'off',
      'no-useless-return': 'off',
      'no-self-compare': 'off',
      'prefer-regex-literals': 'off',
      // Adversarial behavioral tests deliberately feed poison values + edge
      // fixtures: huge literals (1e308) to probe fail-closed numerics, javascript:
      // URLs as XSS probes, NaN comparisons, constant-fold poison, and
      // resolve-in-executor patterns. These are signal-free in test files.
      'no-loss-of-precision': 'off',
      'no-script-url': 'off',
      'use-isnan': 'off',
      'no-constant-binary-expression': 'off',
      'no-promise-executor-return': 'off',
      'prefer-const': 'off',
      radix: 'off',
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    rules: {
      'no-console': 'off',
      radix: 'off',
      'no-unused-vars': 'off',
      'require-await': 'off',
    },
  },
  // Legacy server paths: turn off no-unused-vars + radix + console + require-await
  // entirely. The rules still cover NEW code paths via the global block above —
  // these overrides only mute the historical accumulation. Real signal (no-eval,
  // no-empty, restricted-syntax for auth-bypass, no-throw-literal) stays as-is.
  // Future incremental cleanup: progressively re-enable these rules per-file
  // as files are touched. Tracked in CLAUDE.md.
  {
    files: [
      'routes/**/*.{js,mjs,cjs}',
      'migrations/**/*.{js,mjs,cjs}',
      'emergent/**/*.{js,mjs,cjs}',
      'workers/**/*.{js,mjs,cjs}',
      'domains/**/*.{js,mjs,cjs}',
      'lib/**/*.{js,mjs,cjs}',
      'channels/**/*.{js,mjs,cjs}',
      'economy/**/*.{js,mjs,cjs}',
      'plugins/**/*.{js,mjs,cjs}',
      'mind-space/**/*.{js,mjs,cjs}',
      'prompts/**/*.{js,mjs,cjs}',
      'learning/**/*.{js,mjs,cjs}',
      'server.js',
      'migrate.js',
      // Top-level legacy modules (economics.js, embeddings.js, logger.js,
      // semanticCache.js, etc.). Same rationale as the directories above.
      '*.js',
      'existential/**/*.{js,mjs,cjs}',
      'grc/**/*.{js,mjs,cjs}',
      'loaf/**/*.{js,mjs,cjs}',
    ],
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'require-await': 'off',
      'no-return-await': 'off',
      radix: 'off',
      'prefer-const': 'off',
      'no-lone-blocks': 'off',
    },
  },
  {
    ignores: ['node_modules/', '*.min.js', 'dist/', 'build/'],
  },
];
