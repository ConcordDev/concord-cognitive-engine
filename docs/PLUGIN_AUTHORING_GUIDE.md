# Plugin Authoring Guide

This is the doc that reconciles the four disjoint "plugin/extension" surfaces
this codebase has grown, and tells a genuine third-party developer which one
they actually want. Everything below is grounded in the current state of the
code (re-checked at the time this doc was written — not from memory of any
earlier audit). Where an earlier audit's finding has since changed, that's
called out explicitly.

**If you just want to call Concord's API from your own app, stop here and
read `sdk/index.ts` + `docs/SDK_QUICKSTART.md` instead.** This guide is about
writing code that runs *inside* the Concord process. See §7 for the full
distinction.

---

## 1. The real plugin contract

The one execution engine that actually runs third-party plugin code is
`server/plugins/loader.js` + `server/plugins/validator.js` +
`server/lib/plugin-sandbox.js`. A plugin is a single ESM module. Per the
shape gate (`server/plugins/validator.js:76-122`, `validateShape`), a module
must export:

| Export | Required | Type | Rule |
|---|---|---|---|
| `id` | yes | string | must match `namespace.name` (`/^[a-z0-9]+(\.[a-z0-9_-]+)+$/`, `validator.js:31`) |
| `name` | yes | string | non-empty |
| `version` | yes | string | loose semver `x.y.z...` (`validator.js:32`) |
| `init` | yes | function | called once on activation |
| `destroy` | yes | function | called once on unload |
| `macros` | no | object | map of `"domain.action"` → handler function |
| `hooks` | no | object | map of hook name → handler function |
| `tick` | no | function | called every heartbeat if present |
| `description`, `author`, `license`, `intent` | no | — | metadata only; `intent` feeds Gate 4 (see §5) |

A minimal module that would actually pass all four gates and run correctly
through the sandbox — built directly from the real `ctx` surface in §2, not
from the repo's shipped (broken) example:

```js
// server/plugins/installed/example.hello-counter/index.js
export const id = "example.hello-counter";
export const name = "Hello Counter";
export const version = "1.0.0";
export const description = "Counts DTUs and logs a hello message on each tick.";
export const author = "your-name";
export const license = "MIT";

export function init(ctx) {
  ctx.log("info", "hello-counter initialized");
  return { ok: true };
}

export function destroy() {
  // no timers/handles to release in this example
}

export const macros = {
  "example.dtu-count": async (input, ctx) => {
    return { ok: true, count: await ctx.getDTUCount() };
  },
};

export const hooks = {
  "dtu:afterCreate": async (payload) => {
    // fire-and-forget; loader.js swallows this handler's own rejections
  },
};

export function tick(ctx) {
  // runs once per heartbeat while the plugin is loaded
}
```

Notes on why this shape is correct, not the shipped example:
- No `require`/`import`/`fetch`/`eval`/`new Function` anywhere — none of
  those identifiers exist inside the sandbox's `vm` context at all (see §2
  and the isolation model in `server/lib/plugin-sandbox.js:1-70`), so code
  that references them resolves to `undefined` rather than throwing a
  clean error.
- `macros` keys must contain a literal `.` splitting into `domain` +
  `action` (`server/plugins/loader.js:326-331` / `:777-781`) — a macro name
  with no dot is silently skipped.
- `hooks` keys must be one of the eight names the store pre-declares
  (`server/plugins/loader.js:57-64`): `dtu:beforeCreate`, `dtu:afterCreate`,
  `dtu:beforeUpdate`, `dtu:afterUpdate`, `dtu:beforeDelete`,
  `dtu:afterDelete`, `macro:beforeExecute`, `macro:afterExecute`. Anything
  else is silently ignored (`if (!store.hooks[hookName]) continue;`).

## 2. The real `ctx` surface

There are two `ctx`-shaped things in this codebase and they must expose the
same methods by construction — `buildSandboxedContext`
(`server/plugins/loader.js:439-526`) builds the **host-side** ctx, and the
worker-side `buildCtx` inside `WORKER_BOOTSTRAP_SRC`
(`server/lib/plugin-sandbox.js:115-132`) is what a disk-loaded plugin's
`init`/macro/hook/tick code actually receives, proxied 1:1 through
`bridgeFromHostCtx` (`server/lib/plugin-sandbox.js:227-241`). Re-reading both
right now, the full surface is:

| Method | Source | What it does |
|---|---|---|
| `ctx.pluginId` | `loader.js:461` | the plugin's own id string |
| `ctx.getDTU(id)` | `loader.js:464-467` | returns a frozen shallow-copy of one DTU by id, or `null` |
| `ctx.getDTUCount()` | `loader.js:469-471` | count of all DTUs in memory |
| `ctx.getEmergent(id)` | `loader.js:473-477` | returns a frozen `{id, role, active}` for one emergent entity, or `null` |
| `ctx.callMacro(domain, name, input)` | `loader.js:480-501` | invokes a macro through a **confined** runner (`makeConfinedCtx`, `server/lib/confined-ctx.js`) gated by the plugin's declared macro-grant manifest — default grant for a non-emergent-gen plugin is `["dtu.*", "discovery.*", "art.*", "music.*", "glyph-spells.*"]` (`loader.js:447-449`); calling outside the grant returns an error object, never throws |
| `ctx.log(level, message, data)` | `loader.js:504-508` | routes to the host's log function, tagged `plugin.<pluginId>` |
| `ctx.store.get(key)` / `.set(key, value)` / `.has(key)` / `.delete(key)` / `.clear()` | `loader.js:511-517` | a plain in-memory `Map`, private to this plugin instance — **not persisted across restarts**, and gone when the plugin unloads |
| `ctx.getRateLimit()` | `loader.js:520-522` | returns `{ remaining: Infinity }` for a normal plugin; a real remaining-calls figure only applies to emergent-gen plugins |

That's the entire surface. There is **no** `ctx.createDTU`, **no**
`ctx.schedule` (`.every`/`.cancel`), and **no** ambient `fetch` — a plugin
that wants to create a DTU must go through `ctx.callMacro("dtu", "create",
{...})`, and a plugin that wants periodic work uses `tick`, not a
self-managed timer (`setTimeout`/`setInterval` are in fact banned outright
for emergent-gen plugins by the patterns gate, and for everyone else they
simply don't exist in the vm scope for a disk-loaded plugin — see the
isolation description in `server/lib/plugin-sandbox.js:29-41`).

**The shipped reference example is currently broken against this real ctx
and should not be copied.** `server/plugins/installed/example-knowledge-weather/index.js`
calls `ctx.schedule.every(...)` (line 35), `ctx.storage.get`/`.set` (lines
57, 85 — the real property is `ctx.store`, not `ctx.storage`), a bare
`fetch("http://localhost:5050/...")` (lines 67, 69), and `ctx.createDTU(...)`
(line 77) — none of these exist on the ctx built by `buildSandboxedContext`
or bridged by `bridgeFromHostCtx`. As of this writing there is no sibling
change that has fixed this file; it is still the shape it was when the
original audit found it. Its own header comment ("POST /api/plugins/reload")
is also stale — no such route exists (`server.js` has no
`/api/plugins/reload` handler; see §3 for the real load paths). Treat that
file as a design sketch of *intent*, not as working reference code — use the
table above and the minimal example in §1 instead.

## 3. How a plugin actually gets loaded

There are two distinct code paths today, and they are **not equivalent**:

1. **Boot-time disk scan (the real third-party path).**
   `server.js:32022` calls `loadPluginsFromDisk(STATE, { register, helpers })`
   once at startup (inside a `try/catch`, so a broken plugin directory never
   blocks boot). `loadPluginsFromDisk` (`server/plugins/loader.js:116-164`)
   scans `server/plugins/installed/*/index.js`, reads each file's **raw
   source text**, and for each candidate fires-and-forgets a call to
   `loadPluginFromSource` (`loader.js:148`). `loadPluginFromSource`
   (`loader.js:193-266`) is the hardened path: it runs the pattern gate on
   the raw source first (defense-in-depth layer 1), then spins up a
   `PluginSandbox` (`server/lib/plugin-sandbox.js`) — a real `worker_threads`
   Worker with Node's permission model, a fresh `vm.SourceTextModule`
   context with `codeGeneration: { strings: false, wasm: false }`, and a
   resource-limited heap — evaluates the plugin's module there, reflects its
   shape back, runs the full 4-gate validator against that reflected shape
   (layer 2), and only then activates it. There is currently no HTTP route
   that re-triggers this scan at runtime (no `/api/plugins/reload` exists) —
   dropping a new file into `installed/` takes effect on the next server
   restart only.

2. **In-memory trusted registration (governance/internal path — not a
   third-party submission channel).** `POST /api/plugins/register`
   (`server.js:41790-41797`, gated to `founder`/`owner`/`admin` roles) routes
   through the `emergent.plugin.register` macro
   (`server/emergent/index.js:1839-1846`) into `registerPlugin` →
   `activatePlugin` (`loader.js:1046-1057`, `:734-841`). This path calls
   `pluginModule.init(ctx)` **directly, in-process, with no sandbox worker
   at all** — it exists for already-trusted, already-in-memory module
   objects (emergent-gen plugins post-governance-approval, and tests), and
   because the request body arrives as parsed JSON, `init`/`macros`/`hooks`
   can never actually be live functions over this route in practice. Don't
   present this as "how a plugin author submits a plugin" — it is not that.

**On the gallery specifically:** `server/lib/plugin-gallery.js`'s
`recordInstall` (`plugin-gallery.js:71-80`, wired at
`server.js:34495-34498` as `POST /api/plugins/gallery/:id/install`) —
re-checked directly against the file at the moment of writing this doc —
**only** adds the calling user to an in-memory `Set` and increments an
`installs` counter on the gallery entry. It does not call
`loadPluginFromSource`, `registerPlugin`, or anything else in
`loader.js`. Installing a plugin from the gallery today records that you
installed it; it does **not** cause the plugin's code to run. (Per the task
brief, a sibling unit in this session was expected to possibly wire this —
as of this read, `git log --oneline -10` and `git diff --stat HEAD~5` show
no such change has landed; this doc reflects that current, still-disconnected
state. If that wiring lands later, update this section and §4 together,
since it would materially change the trust story.)

## 4. What "verified" / "trusted" actually means today

Re-verified directly against `server/lib/plugin-signing.js` and the two
gallery routes: **"trusted" is self-attestation, not third-party review.**

- `POST /api/plugins/signing/register-key` (`server.js:34508-34511`) calls
  `registerTrustedKey(authorId, publicKeyPem, db)` with
  `authorId = req.user?.id` (`server.js:34509`) — **the calling user's own
  account id.** Any authenticated user can register a public key as
  trusted for their own author identity. There is no admin approval step,
  no manual review, no separate reviewer role in this path at all.
- `verifyPluginPackage` (`plugin-signing.js:102-114`) then checks: does a
  trusted key exist for this `authorId`, and does the signature verify
  against it? If both hold, `trusted: true`. That's the entire trust
  computation — it proves "this package was signed by whichever keypair
  this author previously registered for themselves," nothing about the
  package's actual safety or a reviewer having looked at it.
- `publishPlugin` (`plugin-gallery.js:17-49`) explicitly allows an
  **unsigned** publish too — it just sets `trusted: false` on the entry
  (`plugin-gallery.js:22, 32`) rather than rejecting it.
- Separately, and unconditionally regardless of the `trusted` flag: any
  plugin that reaches the disk-scan path in §3 goes through the sandbox +
  4-gate validator anyway. The gallery's `trusted` badge and the loader's
  actual security enforcement are two unrelated things — a "trusted" gallery
  entry does not skip validation, and an "untrusted" one is not blocked from
  being manually dropped into `installed/` and loaded exactly the same way.

## 5. The 4 validator gates (what will get your submission rejected)

From `server/plugins/validator.js`, run in this order by
`validatePlugin` (`:224-238`):

1. **Shape** (`validateShape`, `:76-122`) — the required-exports table in
   §1. Missing `id`/`name`/`version`/`init`/`destroy`, a malformed `id` (not
   `namespace.name`), a non-semver `version`, or a `macros`/`hooks` export
   that isn't an object (or `tick` that isn't a function) all fail here.
2. **Namespace** (`validateNamespace`, `:126-157`) — your `id`'s first
   segment must not be one of the reserved namespaces (`emergent`, `system`,
   `loaf`, `grc`, `council`, `ingest`, `plugin`, `marketplace`, `federation`,
   `atlas` — `validator.js:34-37`), your `id` must not collide with an
   already-loaded plugin, and no macro name's domain may fall in that same
   reserved list (no shadowing core macros).
3. **Patterns** (`validatePatterns`, `:161-176`) — a regex sweep over your
   raw source for `process.exit`, `eval(`, `new Function(`,
   `require`/`import` of `child_process`/`fs`/`net`/`dgram`/`cluster`,
   `__proto__`, `constructor.prototype`, and bracket-access on
   `globalThis`/`global` (`validator.js:39-49`). This gate is
   defense-in-depth on top of the sandbox's structural isolation (§2), not
   the only thing standing between your code and the host — but it still
   has to pass.
4. **Dependencies** (`validateDependencies`, `:180-210`) — only runs if you
   declare an `intent` object. `intent.reads` entries must have a root in
   `["dtus","edges","emergents","sessions","sectors","trust","patterns",
   "needs","cascades","journal"]`; `intent.writes` entries must be in
   `["dtus.tags","dtus.meta","dtus.confidence","edges","needs","patterns"]`.
   Declaring no `intent` at all passes this gate automatically for
   human-authored plugins — it's opt-in documentation of your plugin's
   footprint, not currently an enforced sandbox boundary in its own right
   (the actual enforcement of what you can touch is the `ctx` surface in
   §2 and the macro-grant manifest, not this gate).

## 6. Explicit non-goals — what this guide does not cover

- **No public marketplace.** The gallery (§3, §4) is a browsable list with
  an install counter and a self-service trust flag; it is not a curated,
  reviewed app store.
- **No external review process.** Nobody at Concord looks at your plugin
  before it can be dropped into `installed/` and loaded at the next
  restart. The only gates are the four mechanical checks in §5 plus the
  sandbox's structural isolation.
- **No compatibility-version guarantee.** Checked directly for this doc:
  there is no `PLUGIN_API_VERSION`-shaped constant anywhere in
  `server/plugins/` or `server/lib/plugin-sandbox.js` (confirmed by grep at
  the time of writing), and the shape/validator/ctx surfaces carry no
  version negotiation of any kind. A future change to `buildSandboxedContext`
  or the worker bootstrap's `buildCtx` could silently change or remove a
  method your plugin depends on, with no version gate to catch it and no
  deprecation path. Pin your understanding of the ctx surface to the actual
  file, not to this doc's snapshot of it, if you're building something that
  needs to survive engine upgrades.
- **No plugin marketplace payments/monetization** — the gallery tracks
  `installs` and up/down `rating` only; there is no purchase flow.
- **No persistence for `ctx.store`.** It's a plain `Map`; it does not
  survive a plugin unload or a server restart.

## 7. How this relates to the other three surfaces

**`sdk/` (`@concord/sdk`) + `server/openapi.yaml` — a different axis
entirely.** This is a REST client for building an *external* application
that talks to a running Concord server over HTTP (`ConcordClient` in
`sdk/index.ts`, API-key or JWT auth, wraps `/api/lens/run`, DTU CRUD, chat,
etc. — see `docs/SDK_QUICKSTART.md`). Your code runs in *your* process and
calls Concord's API from the outside. Everything in §1-§6 above is the
opposite: your code runs *inside* the Concord server process, with
sandboxed, in-process access to `STATE` and the macro runner. If you want to
build a Slack bot, a dashboard, or a script that reads/writes DTUs from
another machine, you want the SDK, not a plugin. If you want code that
reacts to `dtu:afterCreate` in real time with zero network hop, or that adds
a new `domain.action` macro other lenses can call, you want a plugin.

**`server/lib/plugin-gallery.js` + `server/lib/plugin-signing.js` — the
distribution/discovery layer for the *same* plugin concept as §1-§6, but
currently disconnected from execution.** As established in §3-§4: publishing
to the gallery stores signed source text and a trust flag; installing from
the gallery only bumps a counter. Neither step causes `loadPluginFromSource`
to run. The only path that actually executes a plugin today is the boot-time
disk scan of `server/plugins/installed/`. Treat the gallery as a package
registry with no attached package manager yet — useful for the metadata and
signing primitives it provides, not (today) a way to get a plugin running.

**`server/emergent/developer-sdk.js` — an orphaned, superseded scaffold; do
not build against it.** It is reachable (imported by
`server/emergent/module-registry.js` and dispatched through
`server/routes/sovereign-emergent.js`'s `sdk-*` cases, e.g. `sdk-register`,
`sdk-activate`, `sdk-sandbox` — `sovereign-emergent.js:1337-1420`), and it
has its own tests (`server/tests/emergent-developer-sdk.test.js`), so it
isn't dead code in the sense of being unreachable — but it is a **parallel,
disconnected bookkeeping system**: `registerPlugin`/`activatePlugin`/
`createSandbox` there only create and mutate in-memory metadata records
(API keys, webhook subscriptions, a `Map`-based plugin registry, a "sandbox"
that is literally just a JSON snapshot of DTU metadata with a TTL — see
`createSandbox`, `developer-sdk.js:732-801`, which never evaluates any
code at all). It never calls into `server/plugins/loader.js`, never spins up
a `PluginSandbox`, and has no relationship to the validator's 4 gates. No
plugin code has ever actually executed through this module. If you're
looking for "the SDK for building a Concord plugin," this file's name is
misleading — it is not that; §1-§6 above is the real thing.
