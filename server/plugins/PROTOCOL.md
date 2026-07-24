# Concord Plugin Protocol

> **Canonical-doc note (added during the 2026-07-24 doc-accuracy pass).**
> `docs/PLUGIN_AUTHORING_GUIDE.md` is the canonical, actively-maintained
> reference for the plugin **ctx surface** (§2 there), the **validator
> gates** (§5), and **how a plugin actually gets loaded** (§3) — it is
> re-verified against the code, not written from memory. `docs/PLUGIN_API_CONTRACT.md`
> is the canonical, versioned source of truth for the ctx contract
> specifically (what "v1" guarantees, how a breaking change would be
> rolled out). This file (`PROTOCOL.md`) previously described a
> `PluginContext` shape (`createDTU`/`readDTU`/`searchDTUs`/`llm`/
> `schedule`/`state`) that **does not exist anywhere in the codebase** —
> it was aspirational/never-implemented, presented as real. That section
> has been rewritten below to match the actual ctx built by
> `buildSandboxedContext` (`server/plugins/loader.js`). A few other
> sections here (the validation-gate names, a claimed `/api/plugins/reload`
> route, a "signing not yet supported" line) were also stale and have been
> corrected in the same pass, each with a pointer to the fuller, current
> explanation in the Authoring Guide. Where this file and the Authoring
> Guide ever disagree again in the future, trust the Authoring Guide (or
> re-check the source directly) — this file is kept intentionally short
> and covers plugin *anatomy* + *hooks* (content the Authoring Guide
> doesn't duplicate), not the full ctx/validator/loading story.

Plugins extend the platform with new macros, lifecycle hooks, and per-tick logic. They run inside a sandboxed context — they cannot reach raw `STATE` or arbitrary `require`. The loader (`server/plugins/loader.js`) enforces a four-gate validation pipeline before activation.

## Anatomy

A plugin is one ES module file with these exports:

| Export | Required | Purpose |
|---|---|---|
| `id` | yes | Globally unique identifier in `namespace.name` format. Reserved namespaces (`concord.`, `system.`, `core.`) are blocked. |
| `name` | yes | Human-readable name for UI surfaces |
| `version` | yes | SemVer string |
| `description` | yes | One-paragraph description |
| `init(ctx)` | yes | Called once on load. Receives the sandbox context. Return `{ ok: true }` to activate. |
| `destroy()` | yes | Called on unload. Clear timers/listeners. |
| `macros` | no | Map of `"domain.action"` → handler. Each macro is exposed as `runMacro("domain", "action", input, ctx)`. |
| `hooks` | no | Map of lifecycle hook names → handler. See [Hooks](#hooks) below. |
| `tick(ctx)` | no | Called on every governorTick if present. Runs under a hard timeout (`PLUGIN_TICK_TIMEOUT_MS` in `server/plugins/loader.js`, currently 2000ms) — a tick that exceeds it is aborted and reported, not silently retried. |
| `author`, `license`, `homepage` | no | Metadata for the plugin gallery |

## Sandbox context

`init(ctx)`, macro handlers, hook handlers, and `tick(ctx)` all receive the
same context object. The context is **read-only on STATE** — plugins must
mutate only through whitelisted helpers. This is the *real*, currently-shipping
shape, built by `buildSandboxedContext` (`server/plugins/loader.js`) and
bridged 1:1 into the sandbox worker by `bridgeFromHostCtx`
(`server/lib/plugin-sandbox.js`) — it is the frozen "v1" contract described
in full detail (signatures, defaults, async-vs-sync boundary) in
`docs/PLUGIN_API_CONTRACT.md` and `docs/PLUGIN_AUTHORING_GUIDE.md` §2. Treat
those two docs as canonical if this block ever drifts from the code again.

```ts
interface PluginContext {
  // The plugin's own id, as validated at Gate 1/2.
  readonly pluginId: string;

  // Read-only, frozen snapshot of a single DTU by id, or null.
  getDTU(id: string): Readonly<DTU> | null;

  // Total DTU count in the live substrate.
  getDTUCount(): number;

  // Read-only, frozen snapshot of one emergent entity, or null.
  getEmergent(id: string): Readonly<{ id: string; role: string; active: boolean }> | null;

  // The ONLY write/action path. Routed through a confined runner gated by
  // the plugin's declared macro-grant manifest — default grant for a
  // human-authored plugin is ["dtu.*", "discovery.*", "art.*", "music.*",
  // "glyph-spells.*"]; emergent-gen plugins get ["dtu.*", "discovery.*"].
  // Calling outside the grant (or a reserved namespace) returns an error
  // object — it never throws.
  callMacro(domain: string, name: string, input?: object): { ok: boolean; [k: string]: any };

  // Fire-and-forget logging, routed to the host log tagged `plugin.<pluginId>`.
  // This is the ONE ctx member that is NOT async across the sandbox worker
  // boundary — everything else above/below crosses a worker/vm boundary and
  // should be treated as returning a value synchronously reflected back,
  // not literally awaited by the plugin author (see the two docs above for
  // the exact bridging mechanics).
  log(level: "info" | "warn" | "error", message: string, data?: object): void;

  // Plugin-local key/value store: a plain in-memory Map, private to this
  // plugin instance. Does NOT persist across a plugin unload or a server
  // restart — this is a documented limitation, not a bug.
  store: {
    get(key: string): any;
    set(key: string, value: any): void;
    delete(key: string): boolean;
    has(key: string): boolean;
    clear(): void;
  };

  // Emergent-gen rate-limit status; { remaining: Infinity } for a normal
  // human-authored plugin.
  getRateLimit(): { remaining: number };
}
```

**There is no `ctx.createDTU`, no `ctx.readDTU`, no `ctx.searchDTUs`, no
`ctx.llm`, no `ctx.schedule`, no `ctx.state`, and no ambient `fetch`.** None
of these were ever implemented — an earlier version of this file documented
them as if they were real, which they are not. If your plugin wants to
create a DTU, call `ctx.callMacro("dtu", "create", { ... })`; if it wants a
search, call the appropriate `discovery.*` macro through `ctx.callMacro`;
if it wants periodic work, use the exported `tick(ctx)` function (there is
no self-managed timer — `setTimeout`/`setInterval` don't exist in a
disk-loaded plugin's sandbox scope at all, and are explicitly banned by the
patterns gate for emergent-gen plugins). There is currently no LLM-access
member on ctx at all.

Anything not listed here (raw `STATE`, `db`, `require`, `process`, `fs`,
`fetch`) is unreachable.

**Proposed-but-not-built, if a future session wants to pick this up:** a
`ctx.schedule.{once,every,cancel}` helper (deferred/recurring work without
relying on `tick`) and a rate-limited `ctx.llm.chat(...)` helper (billed to
the plugin author) both appear in earlier design notes and would be
reasonable v2 additions — but as of this writing neither has an
implementation, a tracking issue, or a `CURRENT_API_VERSION` bump backing
it. Do not build a plugin against them; do not present them as available.

## Hooks

| Hook | Fired when | Payload |
|---|---|---|
| `dtu:beforeCreate` | Right before a new DTU is persisted | `{ dtu, ctx }` — return `{ block: true, reason }` to abort |
| `dtu:afterCreate` | After a new DTU is committed | `{ dtu }` |
| `dtu:beforeUpdate` | Before an existing DTU mutates | `{ dtuId, patch }` |
| `dtu:afterUpdate` | After mutation committed | `{ dtu, prev }` |
| `dtu:beforeDelete` | Before tombstoning (DTUs are never hard-deleted) | `{ dtuId }` |
| `dtu:afterDelete` | After tombstone applied | `{ dtuId }` |
| `macro:beforeExecute` | Before any macro runs | `{ domain, name, input }` — return `{ block, reason }` to abort |
| `macro:afterExecute` | After any macro returns | `{ domain, name, result, durationMs }` |

Hook handlers run synchronously in the same heartbeat. There is no
`ctx.schedule` to defer async work onto (see the ctx section above) —
deferred/periodic work is done via the exported `tick(ctx)` function
instead, which the loader calls once per heartbeat under its own timeout.

## Validation gates

Every plugin runs through `server/plugins/validator.js` before activation,
in this order (renamed here to match the actual gate names in the code —
the previous list on this line used different, invented names):

1. **Gate 1 — Shape** — required exports (`id`/`name`/`version`/`init`/
   `destroy`), `id` must match `namespace.name`, `version` must be loose
   semver, and (per `docs/PLUGIN_API_CONTRACT.md`) `manifest.apiVersion`
   must be within the host's currently-supported major-version range.
2. **Gate 2 — Namespace collision** — reserved prefixes blocked, no
   collision with an already-loaded plugin id, no macro shadowing a core
   domain.
3. **Gate 3 — Prohibited patterns** — a regex sweep for banned globals
   (`eval`, `new Function`, `process.exit`, dangerous `require`/`import`
   targets, prototype tampering); emergent-gen plugins are additionally
   forbidden from using `setTimeout`/`setInterval`.
4. **Gate 4 — Dependency check** — only runs if the plugin declares an
   `intent` object; validates declared read/write paths against an
   allowlist. Declaring no `intent` passes this gate automatically for a
   human-authored plugin.

Failed validation = plugin rejected; loader writes a structured log entry.
Full detail (exact regexes, exact allowlists, line numbers) lives in
`docs/PLUGIN_AUTHORING_GUIDE.md` §5 — this list is the short version.

## Author vs emergent plugins

* **Author plugins** live in `server/plugins/installed/<plugin-id>/index.js`. Loaded once at server boot via a disk scan. **There is no `POST /api/plugins/reload` route and no other runtime re-scan trigger for the `installed/` directory** — dropping a new file there takes effect on the next server restart only. (An earlier version of this line claimed a reload route existed; it does not.) A separate, admin-gated (`founder`/`owner`/`admin` role) `POST /api/plugins/register` route DOES let a submission happen at runtime without a restart — it takes `{ source: "<plugin ESM source text>" }` and routes it through the same hardened sandboxed loader as everything else (fixed 2026-07; an earlier version of that route forwarded a parsed JSON body as a live `module` object, which can never work — JSON can't carry functions, so it always failed Gate 1). See `docs/PLUGIN_AUTHORING_GUIDE.md` §3 for the full loading-path breakdown.
* **Emergent-generated plugins** are produced by the substrate itself when a recurring pattern emerges. They require a council governance vote before activation. Source code is persisted to `server/plugins/emergent-gen/<plugin-id>/index.js`.

## Distribution

Author plugins can be packaged as a single file plus a `manifest.json` and shared via the marketplace (DTU type `plugin`). Installation auto-runs validation. Plugin signing DOES exist (`server/lib/plugin-signing.js`) — but it is **self-attestation, not third-party review**: any authenticated user can register a public key as trusted for their own author identity via `POST /api/plugins/signing/register-key`, and an unsigned publish is also allowed (it's just marked `trusted: false`). A "trusted" gallery badge means "signed by a keypair this author registered for themselves," nothing more — it does not skip, replace, or loosen the four validator gates above. Gallery install genuinely runs the plugin's code through the exact same hardened path (static gates + sandbox) as a boot-time disk-scanned plugin — an earlier version of the gallery's install route only bumped an install counter without ever loading the plugin, but that has since been fixed (see `docs/PLUGIN_AUTHORING_GUIDE.md` §3–§4 for the full, re-verified trust story).

## Calling the plugin API from a client

```ts
import ConcordClient from "@concord/sdk";
const client = new ConcordClient(process.env.CONCORD_API_KEY!);

// Run a plugin macro
const r = await client.lens.run("myplugin", "summarize", { text: "..." });

// List loaded plugins
const r2 = await fetch("/api/plugins").then(x => x.json());
```

## Example plugins

* `templates/basic-plugin.js` — minimal "Hello world"
* `templates/emergent-gen-plugin.js` — emergent-generated plugin format
* `installed/example-knowledge-weather/index.js` — publishes a periodic DTU summarizing which DTU kinds are most active + what's trending by citation activity. An earlier draft of this file called `ctx.schedule.every(...)`, `ctx.storage.get`/`.set`, a bare `fetch(...)`, and `ctx.createDTU(...)` — none of which exist on the real ctx — but it has since been rewritten against the real surface (`tick(ctx)` + `ctx.store` + `ctx.callMacro`) and is a genuine, passing, end-to-end-tested working example (`server/tests/plugin-example-knowledge-weather.test.js`). The file's own header comment documents the old broken calls in prose, as a "here's what NOT to do" note — that prose is not live code.
