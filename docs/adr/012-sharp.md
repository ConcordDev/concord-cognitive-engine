# ADR 012: `sharp` as a regular server dependency

| Field      | Value                                                       |
|------------|-------------------------------------------------------------|
| Status     | Accepted                                                    |
| Date       | 2026-10-06                                                  |
| Authors    | Claude Code session (fix/main-frontend-tests)               |
| Supersedes | `sharp` arriving only through `@huggingface/transformers`   |
| Scope      | server runtime dependency                                   |

## Context

`server/lib/asset-gen/organic/generate-organic.js` imports `sharp` at module
top level (it converts the FLUX concept WebP to PNG). `sharp` was never
declared: it only arrived as a dependency of `@huggingface/transformers`, which
sits in `optionalDependencies`, with an `overrides` entry pinning its range.

The 2026-10-06 `npm audit fix` moved `@huggingface/transformers` to 4.3.1,
whose `onnxruntime-node` install can fail (it downloads a native binary). When
an optional dependency fails to install, npm skips its whole subtree — so a
clean `npm ci` produced a tree with no `sharp`, and `server.js` exited at boot
with `ERR_MODULE_NOT_FOUND: Cannot find package 'sharp'`. Same failure shape as
ADR 011: a package the server needs at startup must not depend on an optional
install succeeding.

## Decision

Declare **`sharp`** in `dependencies` (`^0.35.5`) and point the existing
override at it (`"sharp": "$sharp"`), so every transitive copy resolves to the
same declared version. `@huggingface/transformers` stays optional; embeddings
already degrade without it.

## Why not the alternatives

- **Revert the audit fix:** leaves a critical advisory open and keeps the
  server's boot dependent on an optional install.
- **Lazy-import `sharp` inside `generate-organic`:** hides the gap rather than
  fixing it; the module is a real, always-available feature, so its dependency
  should be declared.

## Consequences

`npm ci` installs `sharp` on every box, independent of whether the optional ML
stack installs. `npm audit --audit-level=critical` stays clean.
