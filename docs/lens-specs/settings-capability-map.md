# Settings Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/settings.js` (682 LOC) in full — every macro registered
> via the file's local `reg("settings", "<name>", …)` alias for
> `registerLensAction`, confirmed with
> `grep -c 'reg("settings"' server/domains/settings.js` → **23**. Frontend
> audited by reading `app/lenses/settings/page.tsx` (138 LOC) and all 9
> `components/settings/*.tsx` files (~2,350 LOC combined) in full.

## What this lens is

A real, server-persisted application-settings surface targeting parity
with macOS System Settings / Steam Settings: preferences (graphics,
audio/subtitles, accessibility, language, notifications) sync across
devices, keybinding remap, snapshot capture/restore, and an account &
security panel (2FA, password change, sessions, connected accounts).
Persistence is per-process `Map`s hung off `globalThis._concordSTATE`
keyed by `userId` — no DB migration, by design (see the file's own header
comment) — so state resets on server restart but is real, not fabricated,
within a process lifetime.

## Backend surface — 23 macros, all real and all reachable

`list`, `applied`, `get`, `set`, `setMany`, `reset`, `search`,
`keybindings`, `rebindKey`, `resetKeybinding`, `captureSnapshot`,
`listSnapshots`, `applySnapshot`, `deleteSnapshot`, `accountOverview`,
`sessions`, `revokeSession`, `revokeOtherSessions`, `setTwoFactor`,
`changePassword`, `connectAccount`, `disconnectAccount`,
`connectedAccounts`.

**Wiring mechanism, verified (this needed a correction mid-audit — see
"A methodology note" below):** `server/domains/settings.js` exports
`registerSettingsActions(registerLensAction)`. It is never imported
directly by `server.js` — a first-pass `grep "domains/settings" server.js`
returns nothing, which looked exactly like the codebase's known
"SAVED-CLASS" dead-domain bug (see the batch-6..12 comments in
`server.js` around line 25830 — `saved.js`/`translation.js`/`insurance.js`/
etc. were once written with the `registerLensAction` convention but never
imported, so every call hit `unknown_macro`). It is NOT that bug here:
`server/domains/index.js` (`Domain Action Module Loader`) imports it at
line 206 (`import settings from './settings.js'`) and includes it in the
exported `domainModules` array at line 450. `server.js` loads that array
after `LENS_ACTIONS` is declared (`const { default: domainModules } =
await import('./domains/index.js'); domainModules.forEach(mod =>
mod(registerLensAction));` at server.js:41741-42) — correctly avoiding the
TDZ hazard the file documents for `app`/`LENS_ACTIONS`. So all 23 macros
really do land in `LENS_ACTIONS` at boot, and `/api/lens/run` prefers
`LENS_ACTIONS` over the legacy `MACROS` map.

**A second, unrelated `settings.get`/`settings.set` pair exists in
`server.js`** (lines 27452-60, registered via the legacy `register()` /
`MACROS` convention, operating on `ctx.state.settings` — an internal
engine-config namespace for things like `llmDefault`,
`requireTestsWhenUncertain`, `federationPeers`; consumed by
`GET/POST /api/settings` via `routes/domain.js:291-2` calling `runMacro`
directly). This is a same-named, different-purpose macro pair living in a
different registry (`MACROS`, not `LENS_ACTIONS`). Because `/api/lens/run`
checks `LENS_ACTIONS` first, the settings LENS's frontend (which calls
through `lensRun` → `/api/lens/run`) always reaches the real
`domains/settings.js` handlers, never the engine-config stub. The
`/api/settings` REST route is a separate, unrelated consumer that never
goes through `/api/lens/run`. No collision in practice — documented here
so a future reader doesn't rediscover the same false alarm.

**A methodology note (why this matters beyond settings):** the
`dead-macro-call-detector`'s own doc comment
(`server/lib/detectors/dead-macro-call-detector.js:37-42`) explicitly
lists `settings.js` as one of two files (with `personas.js`) that bind a
local `reg = registerLensAction` alias — it builds its "registered pairs"
set by scanning ALL of `server/` for `register`/`registerLensAction`
calls, regardless of whether the containing file is ever actually
imported and executed. That means the detector would say "yes, this
(domain, macro) pair is registered" even for a genuinely dead file — it
cannot by itself distinguish "registered at boot" from "the string
`register("settings","list",...)` exists somewhere in the tree". Verifying
`domains/settings.js` was live required finding the actual load path
(`domains/index.js`'s `domainModules` array), not just trusting a grep
inside `settings.js` itself. `CLAUDE.md`'s "personas... now registers via
registerLensAction into LENS_ACTIONS" claim was checked against this same
mechanism during this audit and found to be **stale** — `domains/personas.js`
is imported into `domains/index.js`'s array too (line 229/464) — so that
domain is ALSO genuinely live, and the CLAUDE.md claim holds. (Both are
correctly wired; the risk this note flags is generic — "register() call
exists somewhere in server/" is not proof of liveness — not specific to
settings or personas.)

## Reference apps

macOS System Settings / Steam in-game overlay settings — cross-device sync
of preferences, remappable keybindings, and a real account/security panel
(2FA, sessions, connected accounts) are the category-defining features
this lens targets, and all three are real here.

## Frontend inventory

`app/lenses/settings/page.tsx` mounts a 5-tab shell (Preferences /
Keybindings / Snapshots / Account & Security / System & Graphics) plus the
`ManifestActionBar`/`RecentMineCard`/`AutoActionStrip`/
`CrossLensRecentsPanel` scaffold primitives every lens gets. Per tab:

| Tab | Component | Macros called |
|---|---|---|
| Preferences | `PreferencesPanel.tsx` | `list`, `get`, `set`, `reset`, `search` (added this session — see below) |
| Keybindings | `KeybindingPanel.tsx` | `keybindings`, `rebindKey`, `resetKeybinding` |
| Snapshots | `SnapshotManager.tsx` | `captureSnapshot`, `listSnapshots`, `applySnapshot`, `deleteSnapshot` |
| Account & Security | `AccountSecurityPanel.tsx` | `accountOverview`, `sessions`, `revokeSession`, `revokeOtherSessions`, `setTwoFactor`, `changePassword`, `connectAccount`, `disconnectAccount`, `connectedAccounts`, **+ the real `POST /api/auth/change-password`** (added this session) |
| System & Graphics | `QualityPresetSelector.tsx`, `MouseSensitivitySlider.tsx`, `SettingsHealth.tsx` | none of the 23 — see below, by design |

20 of 23 macros are called directly from the lens. `applied` is an
analytics/admin read of the same data `get` returns (own comment: "what
the active session has applied") — not surfaced in the UI by design, no
defect. `setMany` (batch pref writes, used e.g. when applying a snapshot
server-side) is not called from the frontend either — `applySnapshot`
does its own per-key write server-side, so the client never needs the
batch path; this is a reasonable, non-fabricated design choice, not a
missing feature.

`QualityPresetSelector`/`MouseSensitivitySlider` are intentionally
**not** server-persisted: they read/write `localStorage` via
`lib/world-lens/quality-preset.ts` and drive `lib/world-lens/
camera-look-state.ts` directly, because these are 3D-rendering-engine
knobs that must apply instantly client-side (mouse sensitivity is read
every `mousemove`) — cross-device sync would add latency for no benefit.
Both files (`quality-preset.ts`, `camera-look-state.ts`) are real,
confirmed on disk.

`SettingsHealth.tsx` calls the real `GET /api/system/health` (confirmed
at `server.js:47636`) — unrelated to the `settings.*` macro set, a
runtime-status readout, not a preference.

**`UniverseSettings.tsx` and `InitiativeSettings.tsx`** live in
`components/settings/` (part of this audit's assigned read list) but are
**not mounted by the settings lens** — both are mounted on
`app/profile/page.tsx` instead (`grep -rl "UniverseSettings\|
InitiativeSettings" concord-frontend --include=*.tsx` confirms only
`app/profile/page.tsx` + `tests/components/InitiativeSettings.test.tsx`
reference them). Both are real and correctly wired to their own real
backend routes (`GET/POST /api/auth/me` + `/api/auth/choose-universe` for
`UniverseSettings`; `GET/PUT /api/initiative/settings` — confirmed at
`routes/initiative.js`, correctly scoped to `req.user.id` via `_getUserId`
— for `InitiativeSettings`) — no defects found in either, but they are out
of this lens's actual surface (the profile page, not `/lenses/settings`)
so no changes were made to them.

## Authorization audit (the highest-value check per the dispatch brief)

Every one of the 23 macros resolves the acting user via the shared
`actorId(ctx)` helper (`domains/settings.js:119-121`):
```js
function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || "anonymous";
}
```
`ctx.actor` is constructed server-side in `makeCtx(req)`
(`server.js:14060-70`) from `req.actor` (auth middleware) or `req.user.id`
(verified JWT) — **never from client-supplied request body fields**. No
macro in this file accepts a `params.userId` (or similar) to act on a
different account; every read/write is implicitly scoped to the caller's
own session. Checked specifically for the AccountSecurityPanel-touching
macros (`sessions`, `revokeSession`, `revokeOtherSessions`, `setTwoFactor`,
`changePassword`, `connectAccount`, `disconnectAccount`,
`connectedAccounts`) — all confirmed. No cross-account read/write
vulnerability found.

## What was found and fixed

Three real defects, all honesty/correctness bugs — no admin-gating issue
(the domain has no admin-only surface; every macro is legitimately
per-caller).

### 1. `SettingsHealth.tsx` read a response shape the backend has never produced

`GET /api/system/health` (`server.js:47636`) returns
`{ ok, health: { status, uptime, dtuCount, sessionCount, memory: { rss,
heap }, … } }`. The component read `r.data` directly as a flat
`{ status, uptimeSec, memoryMB, activeUsers }` — a shape that has never
existed on this endpoint (no `.health` unwrap, `uptime` vs `uptimeSec`,
`memory.heap` in bytes vs a flat `memoryMB`, no `activeUsers` field at
all). Every tile silently rendered `—` forever; the panel looked
"working" (loading spinner resolved, no error state) while showing no
real data — exactly the "looks live, isn't" pattern `CLAUDE.md`'s
zero-demo-content section calls out. Fixed: unwrap `r.data.health`,
convert `memory.heap` bytes → MB, and use `sessionCount` (the real field —
live WebSocket sessions, the honest proxy for "active users"; there is no
distinct authenticated-user-count field on this endpoint) in place of the
nonexistent `activeUsers`. Also widened the "healthy" status check to
include `"operational"` (the real value the endpoint returns) alongside
the pre-existing `"ok"`/`"healthy"` checks.

### 2. `AccountSecurityPanel.tsx` showed a fake password-change success

`domains/settings.js#changePassword` is explicitly documented as a
policy **pre-check only** — its own comment: "This does not write to the
real auth DB (the auth route owns that)" — and its returned `note` field
literally says "Submit to /api/auth/change-password to finalise credential
rotation." The panel's `submitPassword` called only this pre-check macro
and displayed its `note` as the terminal success message (green
checkmark, cleared password fields) — **the real credential was never
rotated.** A user who "changed" their password here kept logging in with
the old one. This is the single most serious defect found this session:
a fabricated success state on a security-sensitive action. Fixed:
`submitPassword` now makes a second, real call to
`POST /api/auth/change-password` (confirmed real at
`routes/auth.js:805-848` — verifies the current password against the
hash, updates `users.password_hash`) and only reports success once *that*
call succeeds; a real failure (wrong current password, policy violation)
now surfaces the actual backend error via a `pickMessage(e)` helper
(matching the existing idiom in `components/bio/BioActionPanel.tsx` and
several sibling action panels) instead of silently succeeding.

While fixing this, found the pre-check's password-length policy (`< 8`
chars rejected) didn't match the real endpoint's policy
(`schemas.changePassword` at `server.js:6745-8`: `newPassword:
z.string().min(12)`) — a password that passed the in-lens "policy
satisfied" pre-check could still be rejected by the real endpoint on the
very next call. Fixed: aligned the pre-check to the same 12-character
floor, updated the placeholder copy ("8+ chars" → "12+ chars"), and
updated the pinned contract test
(`server/tests/settings-domain-parity.test.js`'s "changePassword enforces
policy" case, which previously accepted a 9-char password) to match.

### 3. `PreferencesPanel.tsx`'s search never called the real `settings.search` macro

The panel's search box filtered the already-loaded preference schema
entirely client-side and never called `settings.search` — a real,
already-built macro that additionally cross-references matching
**keybindings** (e.g. searching "snapshot" would, via the backend macro,
surface the "Capture preset snapshot" keybinding — information the
client-side filter structurally cannot produce, since it only has the
preference schema loaded, not the keybinding list). This is the
"dead-but-real backend capability" pattern the dispatch brief asks to
prefer wiring over inventing new backend code. Fixed: added a debounced
(300ms) call to `settings.search` alongside the existing client-side
filter; when it returns keybinding matches, a small inline hint now
surfaces them ("N matching keybindings — … Open the Keybindings tab to
remap."). The client-side preference filter is left in place (it's
correct and instant for the common case); the search macro's exclusive
value — the keybinding cross-reference — is what's newly wired in.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Cross-device synced preferences (graphics/audio/accessibility/language/notifications) | ALREADY REAL — `PreferencesPanel` ↔ `settings.get`/`set`/`reset` |
| 2 | Remappable keybindings with conflict detection | ALREADY REAL — `KeybindingPanel` ↔ `settings.keybindings`/`rebindKey`/`resetKeybinding` |
| 3 | Snapshot / rollback-to-known-good config | ALREADY REAL — `SnapshotManager` ↔ `settings.captureSnapshot`/`listSnapshots`/`applySnapshot`/`deleteSnapshot` |
| 4 | 2FA with recovery codes | ALREADY REAL — `AccountSecurityPanel` ↔ `settings.setTwoFactor` |
| 5 | Active sessions with revoke | ALREADY REAL — `AccountSecurityPanel` ↔ `settings.sessions`/`revokeSession`/`revokeOtherSessions` |
| 6 | Connected external accounts | ALREADY REAL — `AccountSecurityPanel` ↔ `settings.connectAccount`/`disconnectAccount`/`connectedAccounts` |
| 7 | Password change that actually rotates the credential | **WAS FAKE — FIXED THIS SESSION** (see defect 2) |
| 8 | Search-within-settings spanning keybindings | **PARTIALLY UNSURFACED — FIXED THIS SESSION** (see defect 3) |
| 9 | Runtime/system health readout | WAS SILENTLY BROKEN (wrong shape) — **FIXED THIS SESSION** (see defect 1) |
| 10 | Graphics quality / mouse sensitivity (instant, client-local) | ALREADY REAL by design — `QualityPresetSelector`/`MouseSensitivitySlider` over `localStorage` + live camera state |

**Coverage summary:** 6 of 10 items were already fully real with no
defect. 3 real defects found and fixed (one severe — fabricated password-
change success; two shape/wiring bugs). 1 item (client-local graphics
settings) is correctly out-of-band by design, not a gap.

## Verification

- `cd server && node --test tests/settings-domain-parity.test.js` — **22/22 passing, 0 fail** (after updating the changePassword-policy test case to the corrected 12-char floor).
- `cd server && npx eslint domains/settings.js tests/settings-domain-parity.test.js` — clean, 0 errors/warnings.
- `cd server && node --check domains/settings.js` / `node --check tests/settings-domain-parity.test.js` — syntax OK.
- `cd concord-frontend && npx eslint components/settings/AccountSecurityPanel.tsx components/settings/SettingsHealth.tsx components/settings/PreferencesPanel.tsx` — clean, 0 errors/warnings.
- Project-wide `tsc --noEmit` was attempted but abandoned: at audit time multiple sibling agents were already running concurrent `tsc --noEmit` processes against this same worktree (confirmed via `ps aux` — processes for `spectate`/other lens agents mid-run), and `CLAUDE.md`'s own orchestration discipline says "one heavy Node process at a time on a single box." Correctness on the touched files was instead confirmed via ESLint (which in this repo's config includes `@typescript-eslint` type-aware rules) plus manual type review of every edited block.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged from baseline; `settings` still wired) — re-run after every edit in this session.
- `node scripts/grade-ux-polish.mjs --honest` → `settings`: `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false` (unchanged tier across all edits; re-verified after the final `PreferencesPanel.tsx` change). `audit/` output reverted via `git checkout -- audit/` after every run, per project convention — never committed.

## Files touched

- `server/domains/settings.js` — aligned `changePassword`'s length policy to the real backend's 12-char floor; expanded the doc comment to make the pre-check-only contract explicit.
- `server/tests/settings-domain-parity.test.js` — updated the `changePassword enforces policy` case for the corrected 12-char floor.
- `concord-frontend/components/settings/SettingsHealth.tsx` — fixed the `/api/system/health` response-shape mismatch (defect 1).
- `concord-frontend/components/settings/AccountSecurityPanel.tsx` — wired the real `POST /api/auth/change-password` call so password changes actually take effect (defect 2); updated placeholder copy and doc comment.
- `concord-frontend/components/settings/PreferencesPanel.tsx` — wired the real `settings.search` macro to surface cross-referenced keybinding matches (defect 3).
- `docs/lens-specs/settings-capability-map.md` — this document.
