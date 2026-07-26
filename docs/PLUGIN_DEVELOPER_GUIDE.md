# Plugin Developer Guide

**Audience: you've never seen this repo before.** You want to write a Concord
plugin — code that runs *inside* the Concord server process and reacts to
DTU events or adds a new callable macro — and you want the shortest honest
path from nothing to a working, locally-validated skeleton.

This guide is the on-ramp. It intentionally does not re-derive the plugin
system's internals — every mechanic below links to the doc that owns it, and
if the two ever disagree, the linked doc (and ultimately the code) wins, not
this page.

- The exact `ctx` surface your plugin code receives, the 4 validator gates,
  and the full history of what's real vs. aspirational in this system:
  **`docs/PLUGIN_AUTHORING_GUIDE.md`**.
- The versioned compatibility contract for that `ctx` surface (what happens
  when it changes underneath you): **`docs/PLUGIN_API_CONTRACT.md`**.

If you only read one other file after this one, read
`PLUGIN_AUTHORING_GUIDE.md` §1–§2 — it has the real, current `ctx` method
table and a minimal working example.

---

## 1. What you're building, in plain terms

A Concord plugin is a single ES module that exports a small, fixed set of
things (`id`, `name`, `version`, `init`, `destroy`, and optionally `macros`,
`hooks`, `tick`). You drop it in a directory, the server loads it, and from
then on your `init` runs once, your `hooks` fire when matching DTU/macro
events happen, your `tick` runs once per heartbeat if you declared one, and
anything in `macros` becomes callable by domain+action name just like any
built-in Concord macro.

**The sandbox model, conceptually:** your code does not run in the main
server process's memory space. It runs inside a dedicated `worker_threads`
Worker, inside a `vm.SourceTextModule` context that has code-generation from
strings disabled (no `eval`, no `new Function`), with a resource-limited
heap. There is no `require`, no `import`, no ambient `fetch` — those
identifiers simply don't exist in your plugin's scope. The only way your
code touches the outside world is the `ctx` object handed to `init`, your
macro handlers, your hooks, and `tick` — and `ctx` is deliberately narrow
(read a DTU, count DTUs, call a macro, log, and a private in-memory
key/value store — nothing else). This is a **default-deny** capability
model: you get exactly the surface in the table, nothing you can imagine
your way into. The exact mechanics — which file builds this, how the
worker-side and host-side `ctx` stay in sync, why the shipped example plugin
is actually broken against this shape — live in `PLUGIN_AUTHORING_GUIDE.md`
§1–§2; don't re-derive them here, read that table when you write real code.

**What your plugin can actually change in the world:** only through
`ctx.callMacro(domain, name, input)`, which is itself confined to a grant
list (default `["dtu.*", "discovery.*", "art.*", "music.*",
"glyph-spells.*"]` for a normal human-authored plugin). Calling outside your
grant returns an error object — it never throws, and it never silently
succeeds either.

---

## 2. The local dev loop

The shape is: **scaffold → write your logic → validate locally → publish.**

### 2a. Scaffold a skeleton

```bash
node scripts/scaffold-plugin.mjs <plugin-name> ["Display Name"]
```

This script is real and shipped (verified directly against the current
repo, `server/tests/scaffold-plugin.test.js`, 7/7 passing). It writes a
minimal, already-passing plugin skeleton to
`server/plugins/installed/<plugin-name>/index.js` — that's the exact
directory the real boot-time loader (§3 below) scans — with a real `id` of
the form `<namespace>.<plugin-name>` (default namespace `"authored"`,
override with `--namespace <ns>`), a semver `version`, no-op `init`/
`destroy`, and one working example macro (`<plugin-name>.ping`) exercising
`ctx.log`, `ctx.callMacro`, and `ctx.store` so you have real, running
reference code to edit rather than an empty stub. It refuses to overwrite
an existing plugin directory unless you pass `--force`, supports
`--dry-run` to preview without writing, and self-checks its own output with
`node --check` plus a real `validatePlugin(...)` run before it reports
success.

```bash
node scripts/scaffold-plugin.mjs --validate <path>
```

Standalone mode: imports the plugin module at `<path>` directly (no server
boot) and runs the real 4-gate `validatePlugin(...)` (shape, namespace,
forbidden-pattern sweep, and the opt-in dependency-declaration gate)
against it, printing pass/fail per gate and exiting 0/1 — use this to get
gate failures in seconds instead of at boot.

If you'd rather not use the script, the minimal example in
`PLUGIN_AUTHORING_GUIDE.md` §1 works too — copy it into
`server/plugins/installed/<your-namespace>.<your-name>/index.js` and edit
`id`, `name`, `version`, `description`, `author`, `license` for your
plugin.

### 2b. Write your macro / hook / tick logic

Everything you can read or do is in the `ctx` method table in
`PLUGIN_AUTHORING_GUIDE.md` §2 — it is the authoritative list, and it is
short on purpose. A few things worth internalizing before you write real
logic, so you don't waste time chasing methods that don't exist:

- There is no `ctx.createDTU` — minting a DTU goes through
  `ctx.callMacro("dtu", "create", { ... })`.
- There is no `ctx.schedule` / `.every` / `.cancel` and no ambient
  `setTimeout`/`setInterval` — periodic work goes in your exported `tick`
  function, which the host calls once per heartbeat while your plugin is
  loaded.
- `ctx.store` is a plain in-memory `Map`, private to your plugin instance.
  It does **not** survive your plugin unloading or the server restarting.
  Don't design around it as durable storage.
- `hooks` keys must be one of exactly eight names (`dtu:beforeCreate`,
  `dtu:afterCreate`, `dtu:beforeUpdate`, `dtu:afterUpdate`,
  `dtu:beforeDelete`, `dtu:afterDelete`, `macro:beforeExecute`,
  `macro:afterExecute`) — anything else is silently ignored, not an error.
- `macros` keys need a literal `.` splitting `domain` from `action`
  (e.g. `"example.dtu-count"`) — a dotless key is silently skipped.

### 2c. Declare your API contract version (optional, but do it anyway)

```js
export const manifest = {
  apiVersion: "1.0.0",
  // macros: [...] — your declared capability grant, see §4 below
};
```

If you omit `apiVersion`, the validator treats you as implicitly declaring
`"1.0.0"` — today's baseline, described in full in
`docs/PLUGIN_API_CONTRACT.md`. Declaring it explicitly costs nothing now and
means a future breaking change to the `ctx` surface (a new major version)
has something concrete to check your plugin against instead of silently
handing you a `ctx` shape you weren't written for.

### 2d. Validate locally

`node scripts/scaffold-plugin.mjs --validate <path>` (§2a above) is the fast
local loop — no server boot required. Alternatively, boot the server
locally with your plugin file sitting in
`server/plugins/installed/<your-plugin>/` and read the boot log: a plugin
that fails any of the 4 gates (shape, namespace, forbidden patterns,
dependency declaration — full detail in `PLUGIN_AUTHORING_GUIDE.md` §5) logs
its rejection reason there and simply never activates; it does not crash the
server (`loadPluginsFromDisk` runs inside a `try/catch`).

A plugin that passes all 4 gates and loads successfully will:

- have `init(ctx)` called once — check your logs for whatever you logged via
  `ctx.log`;
- have any declared `macros` become callable through the normal
  `POST /api/lens/run` path with your plugin's `domain`;
- have any declared `hooks` fire on the next matching DTU/macro event;
- have `tick(ctx)` (if present) called on the next heartbeat.

### 2e. Publish

See §4 below — publishing is a separate step from getting your plugin
*running* locally, and the two currently use different mechanisms (disk
placement vs. the gallery HTTP API). Read that distinction carefully before
you assume publishing alone makes your code execute anywhere.

---

## 3. How trust and signing actually work today

**Read this section literally — it is intentionally not flattering, because
the alternative is a false sense of security.**

Concord's plugin system uses **self-attested Ed25519 signing**, not a
reviewed or curated process. Concretely:

1. `POST /api/plugins/signing/keypair` generates you a fresh Ed25519
   keypair (public + private PEM). This is a convenience endpoint — you
   could generate one yourself with any Ed25519 tooling instead.
2. `POST /api/plugins/signing/register-key` registers a public key as
   trusted **for your own authenticated account id**. There is no admin
   approval step and no separate reviewer role anywhere in this path — any
   authenticated user can register a key for themselves, unconditionally.
3. When you publish, you sign your plugin's source with your private key
   (`signPluginSource(source, privateKeyPem)` in
   `server/lib/plugin-signing.js` if you're doing it from Node; the actual
   signing happens on your side, the server never sees your private key).
   The publish call checks whether a trusted key exists for your author id
   and whether your signature verifies against it. If both hold, the
   gallery entry gets `trusted: true`.

**What `trusted: true` proves:** that this exact package was signed by
whichever keypair *you* previously registered for *your own* identity.
**What it does not prove:** that anyone other than you has looked at the
code, or that the code is safe. The gallery's own `trustDescription` field
says this in plain language on every entry: *"Self-attested: signed with a
key this author registered for themselves. Not independently reviewed."*
(and the equivalent honest sentence for the unsigned/unverified case). Treat
that field's wording as the canonical, load-bearing statement of what trust
means here — this guide is just restating it.

**Unsigned publishing is allowed.** `publishPlugin` does not reject a
publish with no signature — it just sets `trusted: false` on the entry
rather than refusing the publish outright.

**Signing and sandboxing are two unrelated things.** A `trusted: true`
gallery entry does **not** skip the sandbox or the 4-gate validator — every
plugin, signed or not, self-attested or not, goes through the exact same
`PluginSandbox` worker+vm isolation and the same 4 static gates before it's
allowed to activate. Trust is a badge about provenance; the sandbox is what
actually keeps your process safe regardless of that badge.

---

## 4. Publishing: what "trusted" and "declaredCapabilities" mean to an installer

`POST /api/plugins/gallery/publish` takes `{ pluginId, name, description,
version, source, signature, manifest }`. Two fields on the resulting gallery
entry matter most to someone deciding whether to install your plugin:

- **`trusted`** — the self-attestation result from §3 above, always paired
  with the plain-language `trustDescription` field so nobody has to infer
  what the boolean means.
- **`declaredCapabilities`** — the macro-domain grant list your plugin will
  actually be confined to at install time (e.g. `["dtu.*", "discovery.*"]`).
  This is not a hand-typed description you could get wrong or let drift —
  it's read from `manifest.macros` if you supplied one (sanitized down to
  non-empty strings), or falls back to the loader's own default grant set if
  you didn't. The load-bearing guarantee: **the capability list a browsing
  user is shown is the exact same list enforced when the plugin installs** —
  disclosure and enforcement can't drift apart, because they're the same
  data read from two call sites, not two independently-maintained copies.

**Installing genuinely runs your code.** `POST
/api/plugins/gallery/:id/install` calls `installFromGallery`, which routes
your published source through the exact same hardened path as a
boot-time-scanned plugin: the static forbidden-pattern gate, then a real
`PluginSandbox` worker+vm evaluation, then the full 4-gate validator against
the sandbox's reflected shape, and only then activation. There is no
shortcut and no fake-success path — a validation or sandbox failure is
reported back to the installing user honestly (as a 4xx with the real
validator error), and is never recorded as a successful install. (An
internal legacy function, `recordInstall`, exists only for back-compat
bookkeeping and deliberately bumps a counter without loading anything — it
is not what the install route calls; don't build against it.)

Because a loaded plugin's macros/hooks are registered once for the whole
running server (not per user), a second user installing an
already-running plugin doesn't re-trigger the sandbox — they just get
recorded as having it, honestly reported as `freshLoad: false` rather than
silently pretending a fresh load happened.

---

## 5. Current moderation state

There is **no human review queue** for published plugins. What exists is a
**lightweight automated gate plus honest labeling** — a deliberate,
approved scope, not a placeholder for a review process that's coming later:

- **Capability disclosure** — every gallery entry shows exactly which macro
  domains it's confined to (`declaredCapabilities`, §4), so an installer
  can make an informed decision without needing a human reviewer to have
  vetted it first.
- **Honest trust labeling** — every entry states plainly whether it's
  self-attested-signed or unsigned/unverified, and that neither case means
  "reviewed" (§3).
- **Mechanical enforcement, not policy enforcement** — the static
  forbidden-pattern gate and the sandbox's structural isolation (no
  `require`, no `fetch`, no `eval`, a confined `ctx.callMacro` grant list)
  are what actually stands between a plugin and the host, for every plugin,
  regardless of trust status.
- **Takedown exists, review does not.** An admin (`owner`/`admin` role) can
  delist a gallery entry via `POST /api/plugins/gallery/:id/delist` with a
  reason. Delisting stops the entry from being listed or newly installed
  going forward, and if the plugin is currently loaded, it is actually
  unloaded (reusing the loader's own teardown path — not a separate,
  parallel one). A delisted entry is still readable by direct id for audit
  purposes. This is a **reactive** control (stop something already found to
  be a problem), not a **preventive** one (nobody screens a plugin before
  it's installable) — know the difference before you assume the gallery is
  curated.

If this scope changes — if a review queue or a stronger pre-publish gate
gets added later — this section and `PLUGIN_AUTHORING_GUIDE.md` §4 should
both be updated together, since they currently tell the same honest story
from two different altitudes.

---

## 6. Quick reference: the whole loop in one place

1. Read `PLUGIN_AUTHORING_GUIDE.md` §1–§2 for the real `ctx` table and a
   working minimal example.
2. Scaffold (`node scripts/scaffold-plugin.mjs <name>`, or hand-copy the
   minimal example) into `server/plugins/installed/<namespace>.<name>/index.js`.
3. Write your `macros`/`hooks`/`tick` against the `ctx` table only — nothing
   else exists in scope.
4. Declare `manifest.apiVersion` (see `PLUGIN_API_CONTRACT.md`) so a future
   breaking host change has something to check you against.
5. Validate locally (`node scripts/scaffold-plugin.mjs --validate <path>`,
   or a local boot + log check).
6. Generate a keypair, register it as trusted for your account, sign your
   source, and publish via `POST /api/plugins/gallery/publish` — understanding
   that "trusted" means "signed by a key you registered for yourself," not
   "reviewed by anyone."
7. Understand that installing (yours or anyone else's) actually executes
   the sandboxed code — there's no cosmetic install path in the real route.
8. Know that moderation today is disclosure + labeling + reactive takedown,
   not pre-publish human review.
