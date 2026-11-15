# ADR 013: `postprocessing` as a direct frontend dependency

| Field      | Value                                                              |
|------------|--------------------------------------------------------------------|
| Status     | Accepted                                                           |
| Date       | 2026-11-14                                                         |
| Authors    | Claude Code session (fix/audit-sweep-20261110, GB-1543)            |
| Supersedes | `postprocessing` arriving only transitively via `@react-three/postprocessing` |
| Scope      | concord-frontend runtime dependency                                |

## Context

`concord-frontend/components/conkay/ConKayScene.tsx` imports `EffectComposer`
and `Bloom` from `@react-three/postprocessing`, which is a React wrapper around
the `postprocessing` library. Up to version 3.0.4, the wrapper listed
`postprocessing` as a regular dependency, so it was installed transitively
(6.39.1 in the lockfile).

HV-32 (`1c211fcc3`) bumped the wrapper to 3.2.2. That version moves
`postprocessing` to `peerDependencies` (`^6.36.0`). The frontend `.npmrc` sets
`legacy-peer-deps=true` (React 19 transition), so npm does not auto-install
peers, and the regenerated lockfile dropped `node_modules/postprocessing`. The
frontend build then failed with `Module not found: Can't resolve
'postprocessing'`. This is the same failure shape as ADR 011 and ADR 012: a
package the app needs must not depend on an incidental install path.

## Decision

Declare **`postprocessing`** in `dependencies` at `^6.39.6`. The previously
locked 6.39.1 supports only `three >= 0.168.0 < 0.185.0`, and the tree is on
`three` 0.187.0. 6.39.6 supports `>= 0.168.0 < 0.188.0` and satisfies the
`^6.36.0` peer range of both `@react-three/postprocessing` and `n8ao`.

## Why not the alternatives

- **Revert `@react-three/postprocessing` to 3.0.4:** this undoes an unrelated
  dependency harvest and still pins `postprocessing` to a release that does not
  support the installed `three`.
- **Drop `legacy-peer-deps`:** `npm ci` would fail on the React 19 peer ranges
  that the `.npmrc` comment documents.
- **Remove the bloom effect:** the ConKay hologram scene uses it by design
  (Track K).

## Consequences

`npm ci` installs `postprocessing` on every box. When `three` gets a future
bump, check `postprocessing`'s `three` peer range too, because npm will not
flag a mismatch under `legacy-peer-deps`.
