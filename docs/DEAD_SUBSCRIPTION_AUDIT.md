# Dead socket-subscription audit (2026-07-25)

> **STATUS: CLOSED.** All 27 are resolved — 13 WIRED with a real emitter, 14
> RETIRED. The checker now reports `dead: 1 total, 1 allowlisted, 0 new` (the
> remainder is the pre-existing allowlisted `social:notification`) and runs as a
> blocking CI step in `.github/workflows/audits.yml`. **No ALLOWLIST entry was
> added to reach green.** Per-class dispositions are recorded inline below;
> commits `f1819adf`, `d1ae68f9`, `031dcb0b`, `4a469478`, `1f764646`.
>
> One finding outgrew this document and is worth reading on its own: wiring
> `tracking:footprints-updated` (Class A) surfaced that `damage_events.x/z` were
> added by migration 299 but never populated by either INSERT — and because
> `THREE.Vector3.set().project()` coerces `null` to `0`, every row rendered a
> *convincing* footprint at world origin. The overlay wasn't blank, it was
> fabricating locations. Fixed in `031dcb0b` before the event was wired.

27 frontend socket subscriptions have **no server emitter**. Found by
`scripts/verify-client-event-contracts.mjs` (commit `f02b1c07`), the checker that
closed the last uncovered quadrant of the frontend/backend contract seam.

Reproduce: `node scripts/verify-client-event-contracts.mjs` (`--json` for machine form).

## Why this document exists

A first attempt resolved 25 of 27 in a single batch. It was stopped and **parked in
`git stash@{0}`** — not discarded — because spot-checking showed it retired 18 events
by deleting them from the `SocketEvent` union, including several whose backend
substrate is demonstrably real. Deleting a listener whose backend exists doesn't fix a
dead subscription; it deletes a feature that was 90% built and hides the evidence.

So: audit first, then operate one event at a time. The parked branch stays available as
a reference for any event where its approach was right.

## The decision rule

For each event, exactly one of:

- **WIRE** — the backend substrate exists and only the realtime push was never added.
  Fixes a dead feature. Requires verifying the emitted payload shape against what the
  listener actually reads; a wired emit with wrong field names is a *new* contract bug,
  not a fix.
- **RETIRE** — no substrate, superseded, or the listener is itself vestigial. Honest
  removal.

Not "whichever is less work." A UI whose socket path is dead while its backend is real
is the "looks built, isn't" defect class this project treats as a hard invariant.

---

## Class A — real HUD component + real substrate → **WIRE** (6)

Each has a mounted component calling `useRealtimeRefresh([...])`, so the UI is already
built to consume a push and currently never receives one.

| Event | Frontend listener | Server substrate |
|---|---|---|
| `extraction:zones` | `components/world/ExtractionRunHUD.tsx:62` | `server/lib/extraction.js` |
| `nemesis:nearby` | `components/world/NemesisGlyphLayer.tsx:85` | `server/lib/npc-relationships.js` (`npc_nemesis`) |
| `party-combat:state` | `components/world/PartyCombatHUD.tsx:69` | `server/lib/party-combat.js` (`party_combat_sessions`) |
| `spectator:count-updated` | `components/world/SpectatorOverlay.tsx:79` | `server/lib/mode-realtime.js` |
| `submarine:dive-state` | `components/world/SubmarineHUD.tsx:46` | `server/lib/embodied/oxygen.js` (`player_oxygen`) |
| `tracking:footprints-updated` | `components/world/FootprintLayer.tsx:57` | `server/lib/world-crime.js` (`tracking_skill_xp`) |

Note `PartyCombatHUD.tsx:60` carries a comment saying it only backstop-polls *while not*
receiving `party-combat:state` — i.e. the component explicitly expects this push and is
permanently in its degraded polling path.

## Class B — SystemFeed entries + real substrate → **WIRE** (4)

All four render into `components/world/SystemFeed.tsx` (lines 77–86). Substrate:
`server/lib/skills/skill-engine.js`, `server/lib/quest-rewards.js`.

| Event | Listener |
|---|---|
| `system:level-up` | `SystemFeed.tsx:77` |
| `system:skill-acquired` | `SystemFeed.tsx:78` |
| `system:skill-evolved` | `SystemFeed.tsx:79` |
| `system:notice` | `SystemFeed.tsx:86` |

## Class C — real `useSocket` handler → **WIRE or RETIRE, needs per-event check** (3)

These have a real `case` branch in `hooks/useSocket.ts`, not just a union entry — so
something was built to handle them.

| Event | Listener | Note |
|---|---|---|
| `chat:tool_result` | `components/chat/PersistentChatRail.tsx:520` | substrate in `server/routes/mcp.js`, `server/lib/mcp-client.js` — likely WIRE |
| `promotion:rejected` | `hooks/useSocket.ts:87`, case at `:516` | check `server/emergent/promotion-pipeline.js` |
| `repair:cycle_complete` | `hooks/useSocket.ts:59`, case at `:503` | check the repair-cortex cycle |

## Class D — false friends → **RETIRE** (5)

The string exists in `server/` but ONLY as an internal event-to-DTU-bridge `type` tag.
`server/emergent/event-to-dtu-bridge.js` contains **zero socket emits**, so these can
never reach a browser. Real name, wrong channel.

`weather:alert` · `market:trade` · `entity:production_mode` · `pipeline:triggered` ·
`repair:cycle_complete` (if the Class-C check confirms it)

`weather:alert` is the instructive one: it shows **6 hits** under `server/`
(`event-to-dtu-bridge.js`, `event-scoping.js`, `feed-manager.js#mapDomainToEventType`)
and still cannot reach a client. Verified 2026-07-25 by tracing `bridgeEvent` — it feeds
DTU creation, never `realtimeEmit`.

## Class E — no component listener at all → **RETIRE** (5)

Present only in the `SocketEvent` union or `EmergentEventFeed.TRACKED_EVENTS`, with no
component consuming them. Nothing is lost by removing the type entry.

`climbing:stamina-state` · `coop:build:edit` · `fishing:cast` · `party-combat:tick` ·
`system:danger-band`

`coop:build:edit` and `fishing:cast` are additionally documented as retired server-side.

**Caveat worth stating**: `climbing:stamina-state` and `party-combat:tick` DO have real
substrates (`server/lib/climbing.js`, `server/lib/party-combat.js`). They land in RETIRE
only because no frontend component consumes them — the union entry is the whole
footprint. If a HUD is later built for either, wiring the emit is the right move then.

## Class F — already half-retired today → **RETIRE remainder** (3)

Removed from `useRealtimeLens`'s `DOMAIN_EVENTS` in commit `daac9787`, but still present
in `hooks/useSocket.ts`'s forwarded list and the `SocketEvent` union — flagged as a known
residual in that commit.

`finance:alert` (`useSocket.ts:152`) · `finance:market_update` (`:151`) ·
`news:breaking` (`:155`)

## Class G — needs investigation (1)

| Event | Listener |
|---|---|
| `boss:phase-enter` | `components/world/EmergentEventFeed.tsx:74` |
| `agent:domain_insight` | `hooks/useSocket.ts:176`, case at `:547` |

World bosses have a real substrate (`world_boss_lockouts`, boss scheduler). Whether a
phase-enter event is meaningful there needs a read of the encounter state machine.

---

## Outcome (2026-07-25)

| Class | Count | Disposition |
|---|---:|---|
| A — real HUD + real substrate | 6 | **WIRED.** 5 in `f1819adf`; `tracking:footprints-updated` held back and landed in `031dcb0b` with the x/z defect fix, because wiring it alone would have shipped fabricated coordinates faster. |
| B — SystemFeed + real substrate | 4 | **WIRED** (`d1ae68f9`), verified at exactly −4 against a clean snapshot. |
| C/G — needed investigation | 5 | **3 WIRED** (`chat:tool_result`, `promotion:rejected`, `boss:phase-enter` — `4a469478`); **2 RETIRED** (`agent:domain_insight`, `repair:cycle_complete` — the latter confirmed a Class-D false friend). |
| D — false friends | 4 | **RETIRED** (`1f764646`). |
| E — no component listener | 5 | **RETIRED** (`1f764646`). |
| F — already half-retired | 3 | **RETIRED** (`1f764646`). |

Two Class-E events (`climbing:stamina-state`, `party-combat:tick`) have real
substrates and were retired **only** because nothing consumes them. If a HUD is
ever built for either, wiring the emit is the right move — that is why they are
recorded here rather than silently deleted.

`lib/lenses/manifest.ts` turned out to matter more than expected:
`hooks/useTilePush.ts` does a real `socket.on()` over every name in a lens's
`realtimeEvents`, so a dead name there is a **live** dead subscription, not an
unused string. Three were dropped from two lenses.

**Targeting, not payload shape, was the whole correctness question for Class A.**
Every one of those listeners uses `useRealtimeRefresh`, which re-fetches on the
event and discards the payload — so field names are irrelevant and the audience
is everything. Two emits are deliberately gated to avoid a socket flood:
`submarine:dive-state` fires only on an enter/exit-water transition (its writer
runs on every player move), and `nemesis:nearby` only when the cycle actually
changed the graph.

## Running order

Wire-class first (they fix real features), retire-class second (mechanical), and the
checker must move monotonically toward zero **without allowlist growth** at every step.
The CI gate goes in only once genuinely green — wiring a known-red gate either breaks the
build or invites silencing it.

Per event: decide, implement, verify payload shape against the listener, add a test that
the emit fires with that shape, re-run the checker, commit that one event.
