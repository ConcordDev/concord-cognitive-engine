# Plugin API Contract

This document is the versioned contract for the **host ctx surface** a
Concord plugin runs against — not to be confused with a plugin's own
`version` field (its release number). Until this doc existed, there was no
place to declare a breaking change to the ctx surface; a future rename inside
`buildSandboxedContext` would have silently broken every installed plugin
with zero warning. `server/lib/plugin-api-version.js` is the code source of
truth; this doc explains the policy in prose.

## How a plugin declares its contract version

```js
export const manifest = {
  apiVersion: "1.0.0",
  // ...other manifest fields (e.g. macros grant list) unaffected by this doc
};
```

`manifest.apiVersion` is a loose semver string (`x.y.z`). Only the **major**
digit is checked for compatibility — minor/patch are documentation only, a
courtesy to plugin authors reading the source, not enforced by the gate.

If a plugin's manifest omits `apiVersion` entirely (every plugin written
before this contract existed, including the shipped
`server/plugins/installed/example-knowledge-weather/index.js`), the
validator treats it as **implicitly declaring `"1.0.0"`** — the baseline
this document describes below. No existing plugin needs a manifest change
to keep passing Gate 1.

## What v1 (`"1.0.0"`) guarantees

v1 is the ctx object built by `buildSandboxedContext`
(`server/plugins/loader.js`) and bridged into the sandbox worker by
`bridgeFromHostCtx` (`server/lib/plugin-sandbox.js`). Every method below is
real, live, and part of the frozen v1 contract:

| Member | Signature | Behavior |
|---|---|---|
| `ctx.pluginId` | `string` | The plugin's own id, as validated at Gate 1/2. |
| `ctx.getDTU(id)` | `(id) => DTU \| null` | Read-only, frozen snapshot of a single DTU. |
| `ctx.getDTUCount()` | `() => number` | Total DTU count in the live substrate. |
| `ctx.getEmergent(id)` | `(id) => { id, role, active } \| null` | Read-only, frozen snapshot of an emergent entity. |
| `ctx.callMacro(domain, name, input)` | `(string, string, object) => result` | The ONLY write/action path. Routed through the confined-ctx capability manifest (`manifest.macros` grant list, default `["dtu.*","discovery.*","art.*","music.*","glyph-spells.*"]` for human-authored plugins, `["dtu.*","discovery.*"]` for emergent-gen) plus the reserved-namespace block and, for emergent-gen, a per-actor rate limit. |
| `ctx.log(level, message, data?)` | `(string, string, object?) => void` | Fire-and-forget logging. The only ctx member that is NOT async across the sandbox worker boundary. |
| `ctx.store.get(key)` / `.set(key, value)` / `.delete(key)` / `.has(key)` / `.clear()` | Plugin-local KV | Per-plugin `Map`, in-memory only. Does **not** survive plugin unload or server restart — this is a documented limitation of v1, not a bug. |
| `ctx.getRateLimit()` | `() => { remaining }` | Emergent-gen rate-limit status; `{ remaining: Infinity }` for human-authored plugins. |

Everything else a plugin might wish existed — `ctx.schedule`, `ctx.storage`,
`fetch`, `ctx.createDTU` — is **not** part of v1 and never was; see
`docs/PLUGIN_AUTHORING_GUIDE.md` and the header comment of the example
plugin for the history of that confusion.

This table is the "what v1 promises" reference. If `buildSandboxedContext`
changes and this table stops matching the code, the table is stale — trust
the code, then fix this doc in the same commit (see CLAUDE.md's "docs are a
build artifact" doctrine).

## How a breaking change is handled going forward

Modeled on VS Code's `engines.vscode` compatibility gate: an extension
declares the minimum VS Code version it needs, the editor refuses to load it
below that floor, and old extensions keep working on newer editors as long as
the API they depend on hasn't been removed. Concord's plugin contract works
the same way, just gated on the plugin's declared version instead of the
host's:

1. **A breaking ctx change bumps `CURRENT_API_VERSION`'s major digit** in
   `server/lib/plugin-api-version.js` (e.g. `"1.0.0"` → `"2.0.0"`) and this
   doc gains a new "What v2 guarantees" table describing the new shape.
2. **`MIN_SUPPORTED_API_VERSION` stays at the old major** for a grace
   period, so plugins still declaring (or implicitly defaulting to)
   `"1.x.x"` keep validating and loading — `isCompatible()` accepts any
   major version in the inclusive range
   `[major(MIN_SUPPORTED_API_VERSION), major(CURRENT_API_VERSION)]`.
3. **The host runs both surfaces side by side** for the grace period: v1
   plugins get the v1 ctx shape (or a shim that reproduces it), v2 plugins
   get the new shape. This is a case-by-case engineering decision at the
   time of the break, not automated by this module — `isCompatible` only
   answers "is this plugin allowed to load," not "which ctx object does it
   receive."
4. **After the grace period**, `MIN_SUPPORTED_API_VERSION`'s major is
   advanced past the old line. Plugins still declaring the retired major now
   fail Gate 1 with `api_version_incompatible` — a clear, actionable error
   naming the plugin's declared version and the host's supported range,
   instead of a silent runtime crash inside a renamed method.
5. **The "implicit apiVersion" baseline never moves.** A plugin manifest
   with no `apiVersion` field is always read as the *original* v1 baseline
   (`"1.0.0"`), never as "whatever the current major is." So an old,
   unmaintained plugin without a manifest update ages out through the same
   grace-period/retirement process as an explicitly-versioned v1 plugin —
   it doesn't get a free pass into a version it was never tested against.

There is no fixed grace-period length specified here — it's a judgment call
at the time of the break (how many installed plugins are affected, how hard
the migration is), made explicitly, not left to erode silently.

## Where the code lives

- `server/lib/plugin-api-version.js` — `CURRENT_API_VERSION`,
  `MIN_SUPPORTED_API_VERSION`, `IMPLICIT_LEGACY_API_VERSION`,
  `isCompatible(declaredVersion)`.
- `server/plugins/validator.js` — Gate 1 (`validateShape`) calls
  `isCompatible` against `pluginModule.manifest?.apiVersion` (or the
  implicit default) and fails with `api_version_incompatible` on a mismatch.
- Pinned by `server/tests/plugin-api-version.test.js`.
