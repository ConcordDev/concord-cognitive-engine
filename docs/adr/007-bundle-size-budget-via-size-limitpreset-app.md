# ADR 007: Bundle size budget enforcement via size-limit + @size-limit/preset-app

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Status     | Accepted                                               |
| Date       | 2026-05-11                                             |
| Authors    | Platinum-gates sprint                                  |
| Supersedes | N/A                                                    |
| Scope      | concord-frontend devDependency                         |

## Context

Sprint 18 (`.github/workflows/platinum-performance.yml`) added a "Bundle
size — size-limit" CI job that enforces per-route gzipped JS budgets
defined in `concord-frontend/.size-limit.json`. The workflow invokes
`npx size-limit` directly:

```yaml
- working-directory: ./concord-frontend
  run: |
    npm ci
    NODE_OPTIONS=--max-old-space-size=6144 npm run build:ci
    npx size-limit
```

With no `size-limit` package in `devDependencies`, `npx` downloads the
CLI on each run but exits non-zero with `Install Size Limit preset
depends on type of the project` — the CLI refuses to operate without
an installed preset. The result: every PR run produced a hard CI
failure on this job, blocking merges for the platinum-tier branches.

Two-package solution required:

1. **`size-limit`** — the CLI / runner itself.
2. **`@size-limit/preset-app`** — the application preset that teaches
   the runner how to measure gzipped JS budgets for a built Next.js
   app (`.next/static/chunks/*` patterns matching the entries in
   `.size-limit.json`).

## Decision

Add both packages to `concord-frontend/devDependencies` at `^12` (the
current line that ships preset-app alongside the runner):

```jsonc
"size-limit": "^12",
"@size-limit/preset-app": "^12"
```

Both are dev-only (used by the CI bundle-size gate, never shipped in a
runtime artifact). The preset-app package transitively pulls in
`@size-limit/file` and `@size-limit/webpack` — both also dev-only.

## Consequences

### Positive

- The bundle-size CI gate now runs deterministically: `npm ci` provisions
  the runner + preset, `npx size-limit` reads `.size-limit.json` and
  reports per-entry sizes against budgets.
- Bundle-size regressions are caught on every PR (currently all 7
  entries — homepage, chat, world, studio, code, expert-mode, byo-keys
  — report well under budget; e.g. world lens at 65 kB gzipped vs
  800 kB limit).
- No additional CI time cost (preset is small; size-limit reuses the
  already-built `.next/` artifacts).

### Negative

- 76 transitive packages added to `concord-frontend/node_modules`
  (per `npm install` output). All are dev-only and don't affect
  runtime bundle weight.
- The `$comment` field convention used elsewhere in the repo is not
  supported by size-limit (unknown-option error); removed from
  `.size-limit.json`. Future config notes go in this ADR or in code
  comments around the workflow step.

### Alternatives considered

- **Roll our own size-checker** — would re-implement gzip + glob +
  budget-asserting logic that the size-limit runner already covers,
  for no value gain.
- **Drop the size-limit job entirely** — the gate is the only place
  bundle regressions are caught before a release. Removing it would
  re-open the "lens authors silently add 500 kB of new dependencies"
  failure mode the gate was built to prevent.
- **Inline `du -b` + gzip in the workflow** — possible but loses the
  per-entry budget DSL in `.size-limit.json` and the human-readable
  table output. Not worth the maintenance cost.

## Related

- `.github/workflows/platinum-performance.yml` — the bundle-size job
- `concord-frontend/.size-limit.json` — the budget DSL
- `concord-frontend/package.json` — devDependencies entry
