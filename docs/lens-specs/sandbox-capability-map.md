# Combat Sandbox Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("sandbox"' server/domains/sandbox.js` → 15

## What this is

`/lenses/sandbox` is a **combat-feel iteration test scene** — not the
roguelite/horde/extraction "sandbox" game modes, and not the code-execution
`harness` macro's `dryRun` sandboxing. It's a real Three.js arena
(`SandboxArena3D`) with a configurable count of training dummies, used to
tune hitstop, telegraph, audio, lock-on, body-language, and combo-evolution
presentation in isolation from the live world simulation. The closest real
category leader is a fighting-game **training room / hitbox lab**
(Street Fighter 6's Training Mode, Tekken's Practice Stage) — frame data,
slow-motion/frame-step, hit recording, and telemetry are exactly that genre's
toolkit, and this lens's slow-motion, frame-step, replay scrubber, and
frame-time/hitstop telemetry overlay map onto it directly.

`/admin/sandbox` is an unrelated lens (B2B tenant provisioning) that happens
to register macros under the same `sandbox` domain name (`provision`/
`kill`/`list`) — deliberately non-colliding macro names, documented at
`server/server.js` around line 25873. Don't confuse the two when grepping.

## Pre-existing state (this was NOT a bare rebuild)

Unlike most Wave 1-3 units, this lens's page (372 LOC), all five bespoke
components (`LoadoutPicker`, `DummyPresetPanel`, `TelemetryOverlay`,
`ReplayPanel`, `SandboxArena3D` — 1,229 LOC combined), and its persistence
domain (`server/domains/sandbox.js`, 14 macros pre-audit) were already
well-built: real field-shape parity between every macro and its consumer,
the canonical `lensRun` double-envelope unwrap (so the fabricated-success
envelope bug class doesn't apply here), two real test suites
(`sandbox-domain-macros.test.js` behavioral + `sandbox-domain-parity.test.js`
contract + a frontend component test), and honest four-state UX (loading /
error / empty / data) in every panel. `node scripts/lens-unsurfaced.mjs
--lens sandbox` reported 0/14 unsurfaced. This is the rare case where the
persistence layer was genuinely complete and the defect was elsewhere.

## The real defect found: the core interaction was dead on arrival

The page header and the domain file's header comment both asserted: "Combat
resolves through the same `/api/worlds/:worldId/combat/attack` + socket
pipeline as the live world — including anti-cheat reach + damage-cap
validation." This was **false** — verified by tracing the actual
`combat:attack` socket handler (`server/server.js` ~line 8685) into
`cityPresence.applyAttack()` (`server/lib/city-presence.js:1181`):

- `applyAttack` requires the attacker to already hold a live position row in
  `_userPositions` — populated only by `player:move` socket emits, which are
  sent **only** by the world-lens page (`app/lenses/world/page.tsx`). The
  stand-alone Combat Sandbox page never sent one, so every attack returned
  `attacker_not_found`.
- `applyAttack` requires the target to be a real spawned NPC in `_npcState`
  — populated only by `cityPresence.spawnNpc()`. Nothing anywhere ever
  spawned an NPC named `dummy_0`..`dummy_9` (grep confirmed exactly one
  `spawnNpc(` call site in `server.js`, unrelated to this lens). Every
  attack would have additionally hit `target_not_found`.

Net effect: clicking a dummy emitted `combat:attack` into the void. The
server never broadcast `combat:hit` (it's gated inside `if (result.ok)`),
so the frontend — which drives 100% of its dummy-HP/hit-log/flash/replay
capture off the `combat:hit` subscription, with zero local prediction — showed
**no damage number, no hit-log entry, no flash, nothing** on every single
click. This is the lens's entire designed interaction, silently broken, with
a header comment actively asserting it worked.

A second, related dormant bug: `realtimeEmit("combat:hit", ...)` in the
socket handler is called with no scoping options, so it falls through to a
platform-wide `io.emit()` — every connected player's combat, not just this
arena's. Once the pipeline was wired to actually receive events, the
sandbox's hit-log/HP handler would have needed to filter to its own dummy
ids or it would have shown live-world combat noise mixed into a supposedly
isolated feel-tuning session.

## The fix

`server/domains/sandbox.js` — added `sandbox.enterArena({count, hp, reset})`:
registers the caller into a private, per-user city (`sandbox_<userId>`) via
`cityPresence.updateUserPosition`, then spawns/refreshes real dummy NPCs
(`sandbox_<userId>_dummy_<i>`) positioned within the socket path's 3m attack
range via `cityPresence.spawnNpc`. `reset: true` fully heals every dummy
(mount / Reset button / applying a preset); omitted, only newly-added
dummies are freshly spawned so an add/remove-dummy count change can't
silently heal a dummy mid-fight — the response always echoes each dummy's
real, authoritative server health (`existing.health`) so the client
resyncs instead of drifting from its own local HP subtraction. Per-user
city scoping (verified by test) means two simultaneous sandbox sessions
never share or corrupt each other's dummy NPCs.

`app/lenses/sandbox/page.tsx` — calls `enterArena` on mount and from every
mutating action (`resetDummies`, `addDummy`, `removeDummy`,
`applyDummyConfig`), keeping the existing instant optimistic local update
and firing the sync in parallel (Linear-style optimistic-then-reconcile,
per the fluidity invariant) rather than blocking the click on a round trip.
`fireAttack` now gates on `arenaReady` so an attack fired in the brief
pre-sync window (which would guaranteed-fail server-side anyway) doesn't
hit the socket. The `combat:hit` subscriber now filters to the arena's own
dummy ids (via a `dummiesRef` mirror, since the subscription effect mounts
once) before touching the hit log / HP / flash / replay-recorder, closing
the platform-wide-broadcast noise bug. It also now prefers the event's
authoritative `targetHealth` field over local subtraction when present. A
small non-blocking "entering arena…" indicator (no fake progress — a plain
pulse, gone the instant `arenaReady` flips) surfaces the brief real network
window honestly instead of hiding it.

## Verification

- `node --check server/domains/sandbox.js` — clean.
- `cd server && npx eslint domains/sandbox.js tests/sandbox-domain-macros.test.js` — clean.
- `cd concord-frontend && npx eslint app/lenses/sandbox/page.tsx` — clean.
- `node --test server/tests/sandbox-domain-macros.test.js server/tests/sandbox-domain-parity.test.js` — **29/29 passing** (14 new/updated assertions across 5 new `enterArena` cases: real attacker registration, real NPC spawn, an actual `cityPresence.applyAttack()` round-trip succeeding end-to-end, per-user isolation via `different_city`, reset-vs-preserve health semantics, shrink-despawn, and clamp/fail-closed numeric guards).
- `npx vitest run tests/components/SandboxLoadoutPicker.test.tsx` (concord-frontend) — 5/5 passing, unaffected.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `sandbox`: `tier: "polished"`, `isGenericScaffold: false`.
- `git checkout -- audit/` after the grader run (transient artifacts not committed).

## Genuinely missing (deferred) — triaged

- **Damage/element variety in the Hit Log beyond what the loadout already sends** — not missing; the loadout picker already lets the tester swap weapon/skill/element and the hit log reflects real server-computed crit/damage. No gap.
- **Frame-data overlay (startup/recovery windows) as a visible ruler, matching a real fighting-game training room's most iconic feature** — real frame data already exists server-side (`server/lib/combat-frame-data.js`, `GET /api/combat/frame-data/:skillId`, public-read) but this lens's `TelemetryOverlay` doesn't surface it. **ENGINEERING** — no external data dependency, existing endpoint, a follow-up panel could plot startup/active/recovery bars per equipped skill. Left out of this pass to keep the fix surgical to the confirmed defect; not a fabricated-data risk either way since nothing currently claims to show it.
