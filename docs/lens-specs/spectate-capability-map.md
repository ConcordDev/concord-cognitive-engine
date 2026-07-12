# Spectate Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/spectate.js` (229 LOC) in full and confirmed with
> `grep -c 'register("spectate"' server/domains/spectate.js` → **5 macros**
> (the task brief's preliminary grep of 5 was correct — no inline
> registrations elsewhere: `grep -rn '"spectate"' server/*.js server/domains/*.js`
> shows nothing outside this file plus the `publicReadDomains` allowlist entry
> at `server.js:11134`). Frontend audited by reading both
> `app/lenses/spectate/page.tsx` (295 LOC after fixes, 226 before) and
> `app/lenses/spectate/[worldId]/page.tsx` (384 LOC after fixes, 359 before)
> in full — no separate `components/spectate/*` directory exists; `MarketCard`
> is a local component inside `[worldId]/page.tsx`.

## What this lens is

A read-only Twitch-shape spectator surface onto Concordia's authored
sub-worlds: an index grid of live spectacles (`/lenses/spectate`) and a
per-world detail view (`/lenses/spectate/[worldId]`) with a live event
ticker, goddess dispatches, and open parimutuel SPARKS prediction markets
you can wager on. "Spectator mode is read-only for the world simulation —
you cannot interact with residents" (header comment, both pages) — betting
is the one explicit action, and it's non-extractive (SPARKS, not CC).

## Backend surface — 5 macros, all real

- `spectate.list` (public read) — merges `lib/spectator-mode.js`'s in-memory
  socket watcher counts with `lib/betting-markets.js#listOpenMarkets` per
  world; returns `{spectacles, count, liveCount, currency}`.
- `spectate.get` (public read) — one world's full spectacle: watcher count +
  open markets (with implied YES/NO odds) + recent goddess dispatches from
  `lib/goddess-broadcaster.js#recentDispatches` (best-effort, never breaks
  the read if the lib/table is absent).
- `spectate.bet` (actor-gated) — delegates to `betting-markets.js#placeBet`
  (real SPARKS escrow debit, `market_positions` row insert, pool update),
  with a fail-CLOSED numeric guard (`badNumericField`) on `stakeSparks`
  before any DB write.
- `spectate.watch` (public, anonymous allowed) — delegates to
  `lib/spectator.js#startSession`, which INSERTs a real
  `spectator_sessions` row (migration 162) and returns a session token +
  `wsHint`.
- `spectate.my_positions` (actor-gated) — delegates to
  `betting-markets.js#userPositions`, the caller's bet history
  (open + resolved, joined against `prediction_markets` for question/status).

All five are exercised by `server/tests/spectate-domain-macros.test.js`
(12/12 passing) against a real in-memory `better-sqlite3` DB seeded with
migration 162's schema — not shape-only stubs.

## Reference app

Twitch/Kalshi-Polymarket hybrid — live viewer count + event feed (Twitch) +
a parimutuel prediction market on the outcome (Polymarket/Kalshi shape,
minus real-money settlement — SPARKS is closed-loop in-game currency).

## What was found and fixed

### 1. `spectate.my_positions` was real, tested backend capability with zero frontend caller (dead capability)

`grep -rn "my_positions\|myPositions" concord-frontend/` before this pass
turned up nothing under `app/lenses/spectate/` — the macro existed, was
registered, was tested, and was never called from either page. A caller's
own SPARKS wager history (open bets + resolved win/loss) was invisible.

**Fix:** `concord-frontend/app/lenses/spectate/page.tsx` now fetches
`spectate.my_positions` on mount + every 15s (mirrors the existing
`refresh`/`refreshPositions` pairing already used for the spectacle grid)
and renders a "My positions" panel above the grid — question, side
(YES/NO), stake, and outcome (open / won `+payout` / lost). Per the
honest-empty-state rule, an anonymous visitor or a signed-in user with zero
bets renders **no placeholder at all** — the section conditionally mounts
only when `positions.length > 0`, and a `no_actor` macro failure is
swallowed silently (anonymous browsing of this lens is legitimate by
design, per `spectate.watch`'s own "Anonymous watching is allowed" comment
in `server/domains/spectate.js:206`).

### 2. The "Live event stream" ticker was structurally dead — it listened for events that are never dispatched

`app/lenses/spectate/[worldId]/page.tsx` (pre-fix) had:

```tsx
const evts = ['npc:conversation-bid', 'combat:hit', 'faction-war:started', 'dtu:promoted', 'world:event:scheduled'];
for (const evt of evts) window.addEventListener(evt, onEvent as EventListener);
```

Two independent problems made this permanently non-functional, verified at
runtime-truth level (grep across the whole frontend, not assumed):

- **No code anywhere in `concord-frontend/` ever calls
  `window.dispatchEvent(new CustomEvent('combat:hit', ...))`** (or any of
  the other four names). `grep -rn "window.dispatchEvent(new CustomEvent"
  concord-frontend/` returns ~50 hits and none of them are these five
  events. The real event-delivery mechanism in this codebase is Socket.IO
  (`lib/realtime/socket.ts#subscribe`), which `EmergentEventFeed.tsx` and
  `AttentionPanel.tsx` use directly — this page was the outlier, listening
  on a channel nothing writes to.
- **The event name itself was wrong for one of the five** —
  `faction-war:started` is not emitted anywhere in `server/`
  (`grep -rn "faction-war:started" server/` only matches a
  `cross-world-feed.js` weight-table key, not an emit site). The real
  socket events for faction moves are `faction:war-declared` /
  `faction:alliance-formed` / `faction:truce-sought`
  (`server/lib/embodied/faction-strategy.js:464-474`).

Additionally, `npc:conversation-bid` (the one event genuinely worth
per-world scoping — it's emitted `io?.to('world:${worldId}')?.emit(...)` in
`server/emergent/npc-conversation-initiator.js:37`) requires the client
socket to have joined that Socket.IO room. No code anywhere joins a
`world:${worldId}` room except `spectator-mode.js#joinSpectator`, which
itself is never invoked from any live socket handler (only from tests) —
confirmed by `grep -n "joinSpectator" server/server.js` returning nothing.
The generic `socket.on("room:join", ...)` handler at `server.js:8485` DOES
allow any authenticated socket to join an arbitrary `world:*` room (only
`session:*` and `org:*` rooms carry an ownership check) — this is the real,
reachable mechanism other lenses already use via
`hooks/useLensRealtime.ts`'s `rooms` option (`lib/realtime/socket.ts`'s
`joinRoom`/`leaveRoom`, which emit `room:join`/`room:leave`).

**Fix:** replaced the `window.addEventListener` block with real
`subscribe()` calls from `@/lib/realtime/socket` for the SocketEvent
literals that are actually emitted server-side —
`npc:conversation-bid`, `combat:hit`, `dtu:promoted`,
`world:event:scheduled`, `faction:war-declared`,
`faction:alliance-formed` — and added `joinRoom('world:${worldId}')` /
`leaveRoom(...)` on mount/unmount so `npc:conversation-bid` (the one
event with a real, room-scoped, per-world `worldId` field per
`server/lib/event-shapes.js:128-131`) is now genuinely reachable and
correctly filtered to the world being spectated.

**Update (Wave 4, 2026-07-12) — the upstream `worldId` gap named below is
now CLOSED.** The four emit sites this section used to flag were re-verified
against the live tree (line numbers had already drifted from the ones
originally cited here) and fixed:

- `combat:hit` (`server.js`'s `combat:attack` socket handler, ~line 9043) —
  now stamps `worldId` from `cityPresence.getUserPosition(userId).worldId`.
  Investigating this surfaced a real, separate, pre-existing bug: the
  `cityPresence.getPlayerWorld` accessor this fix would naively have reused
  (already called at 3 other sites in `server.js` — `combat:impact` right
  below this one, plus two more) does not actually exist anywhere on
  `lib/city-presence.js`'s exports, so every one of those calls was silently
  `undefined` and fell back to the hardcoded `"concordia-hub"` default
  regardless of the player's real world. The fix routes through
  `getUserPosition(userId).worldId` instead — the real, populated field —
  which also incidentally makes the sibling `combat:impact` emit's worldId
  correct for the first time (same shared local variable, no logic change to
  `combat:impact` itself). The other 3 dead `getPlayerWorld` call sites are
  untouched (out of scope for this pass) and still silently default.
- `dtu:promoted` (`server.js`'s `scope.promote` macro, ~line 37769) — now
  stamps `worldId` **only** when the promoted DTU actually carries one
  (`dtu.world_id ?? dtu.worldId ?? dtu.meta?.world_id ?? dtu.meta?.worldId`).
  DTUs are cross-world by design (no formal `world_id` field on the
  in-memory `dtu` object — see CLAUDE.md's DTU substrate notes), so this is
  honestly absent for most promotions rather than invented as
  `"concordia-hub"`.
- `world:event:scheduled` — turned out to **already** carry `worldId` on
  every emitted payload (`lib/world-event-scheduler.js#tick()` merges
  `{ ...c, worldId }` onto each created event, confirmed via `git blame` to
  be original code, not a recent fix) — the original claim above was stale.
  The only real gap was that the event had no `event-shapes.js` entry at
  all; it now does.
- The three `faction:*` events (`lib/embodied/faction-strategy.js#applyMove`,
  ~line 490) now stamp a best-effort `worldId` via a new
  `resolveFactionWorldId(db, factionId)` export, resolved from the faction's
  living NPCs — de-duplicated from an equivalent helper
  (`resolveFactionWorld`) that already existed in
  `emergent/faction-strategy-cycle.js` for a different, cosmetic purpose
  (faction-war spawn metadata). Genuinely null (never invented) for a
  faction with no seeded NPCs.

`event-shapes.js` marks `worldId` **optional**, not required, on all four
schemas — each has at least one legitimate emit path (a different
`combat:hit` emitter in `lib/combat-netcode.js`, other `dtu:promoted` emit
sites in `economy/global-gates.js` / `routes/sovereign.js`, DTUs with no
world scope, factions with no seeded NPCs) that can't always supply it.

The ticker's `push()` filter (unchanged from the original fix above) now
genuinely exercises `worldId` for all six of these previously-unfiltered
event types, and gained a `faction:truce-sought` subscription it never had
before this pass. A spectator of `tunya` no longer sees `combat:hit` /
`dtu:promoted` / `faction:*` events from other worlds whose payload carries
a different world's id; an event with no resolvable `worldId` (a fair
share of `dtu:promoted` traffic, by design) still surfaces, honest-signal-
beats-no-signal, same as before.

**Still open, out of scope for this pass:** `realtimeEmit`'s actual socket
transport for these events is unchanged — `combat:hit`/`dtu:promoted`/
`faction:*` are still `REALTIME.io.emit(...)` (a genuine platform-wide
broadcast to every connected socket, not scoped to a `world:${worldId}`
room), so every connected client still *receives* every world's traffic;
what's fixed is that a per-world consumer can now correctly *filter* it
client-side. Actually room-scoping the emit itself would be a larger,
riskier change (every consumer — the world lens's own combat/VFX/audio
bridges included — would need to join the right room to keep working) and
was explicitly out of this task's scope. Other in-world consumers of
`combat:hit` (`CombatVFXBridge.tsx`, `ImpactMomentumBridge.tsx`,
`AdaptiveMusicBridge.tsx`, `TargetNameplate.tsx`, `WorldAudioBridge.tsx`,
`app/lenses/world/page.tsx`) still receive every world's hits unfiltered —
a real, related gap this pass surfaced but did not fix, since it touches
gameplay-feel code outside this task's file scope.

Tests: `server/tests/contract/heartbeat-emits.test.js` ("Wave 4 worldId
stamping" describe block, faction events), `server/tests/world-event-
scheduler.test.js` (`tick()` worldId describe block), `server/tests/
wave4-event-worldid.test.js` (combat:hit's city-presence dependency +
dtu:promoted's derivation formula + event-shapes round-trips),
`concord-frontend/tests/lenses/spectate-worldid-ticker.test.tsx` (the
ticker's filter behavior, end to end through the mocked socket layer).

---

**Original finding (superseded by the update above, kept for history):**
**Honest residual, not fixed (out of scope for this pass — would require
touching `server/server.js` combat/DTU/faction emit sites, off-limits per
the task's file-scope constraint and shared by five other in-flight
agents):** `combat:hit` (`server.js:8961`), `dtu:promoted`
(`server.js:37230`), `world:event:scheduled` (`server.js:35092`), and the
three `faction:*` events (`faction-strategy.js:464-474`) are all emitted as
**platform-wide broadcasts with no `worldId` field on the payload** — a
real gap in those upstream emit sites (this is not `spectate`-specific;
it affects every consumer of those events platform-wide, e.g.
`EmergentEventFeed.tsx` has the identical limitation). The ticker still
surfaces them (real signal beats no signal) and filters to the current
world whenever a payload does carry one, matching the pre-fix code's own
filter semantics — but until those emit sites are given a `worldId` field,
a spectator of `tunya` will also see `combat:hit` events from every other
world. This is now an honest, working, partially-scoped ticker instead of
a permanently-empty one — a real improvement, with the remaining precision
gap called out here rather than silently left implied-fixed.

### 3. The `spectate.watch` → `wsHint` stash was dead code implying nonexistent infrastructure

Pre-fix, on mount the `[worldId]` page called `spectate.watch`, then did:

```tsx
(window as unknown as Record<string, unknown>).__spectateWsHint = hint;
```

`grep -rn "__spectateWsHint" concord-frontend/` (post-fix) shows this was
the only read *or* write of that global — nothing ever consumed it — and
`grep -rn "/ws/spectate" server/` shows no `/ws/spectate/:worldId` endpoint
exists anywhere; `wsHint` (`server/lib/spectator.js:22`) is a string the
frontend never actually connects to. This wasn't fabricated data (the
`spectator_sessions` row + session token + wsHint string are all real,
persisted, and tested — `server/tests/spectate-domain-macros.test.js:73`),
but stashing an unconsumed hint implying a live-streaming WS endpoint that
doesn't exist is exactly the kind of half-wire this program looks for.

**Fix:** kept the real, valuable side effect (`spectate.watch` still fires
on mount — it persists a real spectator session row, which is what
`spectator.list_for_world` / ops telemetry actually reads) and dropped the
dead `window.__spectateWsHint` stash + its misleading comment. The
now-real socket-event ticker (fix #2) is the actual live-event mechanism
this page uses; `wsHint` remains part of the macro's honest return shape
(still pinned by the existing backend test) but the frontend no longer
pretends to act on it.

## Step 5 — authz / cross-user data-leak audit (no defect found)

Checked whether any spectate macro lets a caller enumerate data about a
world/player they shouldn't see, given the CLAUDE.md invariants on
`player_inventory` being user-global and `personal_dtus_never_leak`:

- `spectate.list` / `spectate.get` read only aggregate, inherently-public
  data: live watcher counts (no PII — the same shape as the pre-existing
  public `/api/worlds/spectator-counts` endpoint), open prediction-market
  rows (question/pool/odds — public by the nature of a betting market), and
  `goddess_dispatches` (world-flavor text keyed by `world_id`, not by
  user — `server/lib/goddess-broadcaster.js:77-86`, `SELECT id, tone,
  ecosystem_score, refusal_strength, drift_kind, body, composed_at ...
  WHERE world_id = ?`). No personal-scope DTU, inventory, or per-user field
  is reachable through either macro regardless of what `worldId` is passed.
- `spectate.bet` and `spectate.my_positions` are actor-gated off
  `ctx.actor.userId` — neither accepts a caller-supplied `userId` param, so
  there is no cross-user read/write vector (`userPositions(db, userId)` is
  always called with the *caller's own* id from context, never an
  attacker-controlled one).
- `spectate.watch` accepts an arbitrary `worldId` but only ever writes a row
  keyed by `(world_id, session_token, viewer_user_id)` — no read of
  anyone else's data.

This is not an operator/admin surface (unlike psyops/ops/repair-telemetry
elsewhere in this wave) — it's genuinely public-read spectacle data by
design, so the `announcements.js`-style admin-gate idiom does not apply
here. No fix needed.

## Step 6 — field-shape audit (no mismatch found)

Cross-checked every macro's actual return shape against what the UI reads:
`spectate.list` → `{spectacles[]}` read as `node.result.spectacles`;
`spectate.get` → `{spectacle: {watching, openMarkets, openMarketCount,
totalPoolSparks, dispatches, live}}` read as `node.result.spectacle.*`;
`spectate.bet` → `placeBet`'s `{ok, marketId, side, stake, currency}` read
via `node.result?.ok`; `spectate.watch` → `startSession`'s `{ok,
sessionToken, worldId, wsHint}`. All match field-for-field. No mismatch.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Live viewer/watcher count per world | ALREADY REAL — `spectate.list`/`.get` merge real Socket.IO spectator counts (`lib/spectator-mode.js`) |
| 2 | Per-world detail view with live event feed | **FIXED THIS PASS** — was structurally dead (window events nobody dispatches); now real Socket.IO `subscribe()` + room join |
| 3 | Parimutuel prediction markets w/ live odds | ALREADY REAL — `spectate.bet` → `betting-markets.js#placeBet`, real SPARKS escrow, real pool math, `MarketCard` is a designed bet-slip UI (side toggle + stake input), not a generic form |
| 4 | Bettor's own position/wager history | **FIXED THIS PASS** — real backend (`spectate.my_positions`), zero frontend caller before this pass |
| 5 | World flavor / narrative color | ALREADY REAL — goddess dispatches (`goddess-broadcaster.js`) + `/api/worlds/:id/flavor` description/climate chips |
| 6 | Graceful degrade without auth/backend | ALREADY REAL — index page falls back to public `/api/worlds/spectator-counts`; detail page does the same |
| 7 | Cross-user data isolation | ALREADY REAL, verified this pass — no leak vector found (Step 5 above) |

**Coverage summary:** 5 of 7 already real, 2 fixed this pass (both were
"backend exists, frontend either doesn't call it or calls a channel that
doesn't exist" — the exact defect class this program targets). No
fabricated data was found or introduced; both fixes replace dead/misleading
wiring with real backend calls, never a fake success path.

## Files touched

- `concord-frontend/app/lenses/spectate/page.tsx` — added the `my_positions`
  fetch + "My positions" panel.
- `concord-frontend/app/lenses/spectate/[worldId]/page.tsx` — replaced the
  dead `window.addEventListener` ticker with real `subscribe()` +
  `joinRoom`/`leaveRoom` calls against `@/lib/realtime/socket`; dropped the
  dead `__spectateWsHint` window stash.
- `server/domains/spectate.js` — **not touched**; audited only. All 5
  macros were already correct, tested, and honestly shaped.

**Wave 4 (2026-07-12) — closing the platform-wide `worldId` gap:**

- `server/server.js` — `combat:hit` and the sibling `combat:impact` emit
  (socket `combat:attack` handler) now derive a real `worldId` from
  `cityPresence.getUserPosition(userId).worldId`; `scope.promote`'s
  `dtu:promoted` emit now stamps `worldId` only when the DTU actually
  carries one.
- `server/lib/embodied/faction-strategy.js` — new exported
  `resolveFactionWorldId(db, factionId)`; `applyMove`'s three
  `faction:*` emits now include it (optional, omitted when unresolvable).
- `server/emergent/faction-strategy-cycle.js` — its local
  `resolveFactionWorld` duplicate removed in favor of importing the new
  shared `resolveFactionWorldId`; one call site updated, no behavior change.
- `server/lib/event-shapes.js` — added a `world:event:scheduled` entry
  (previously unregistered); added `worldId` (optional) to `combat:hit`,
  `dtu:promoted`, `faction:war-declared`, `faction:alliance-formed`,
  `faction:truce-sought`.
- `concord-frontend/app/lenses/spectate/[worldId]/page.tsx` — the ticker's
  `combat:hit`/`dtu:promoted`/`faction:war-declared`/`faction:alliance-formed`
  subscriptions now pass the payload's `worldId` into the existing `push()`
  filter; added a `faction:truce-sought` subscription (was missing entirely).
- New tests: `server/tests/contract/heartbeat-emits.test.js` (extended),
  `server/tests/world-event-scheduler.test.js` (extended),
  `server/tests/wave4-event-worldid.test.js` (new),
  `concord-frontend/tests/lenses/spectate-worldid-ticker.test.tsx` (new).

## Verification

- `cd concord-frontend && npx vitest run tests/lenses/spectate-page.test.tsx` — **7/7 passing** (pre-existing index-page test suite; the "My positions" addition doesn't change any of the four UX-state assertions since positions render conditionally and the tests never mock `spectate.my_positions`, so it resolves to the default unmocked rejection and the panel simply stays unmounted, exactly as the honest-empty-state design intends).
- `cd server && node --test server/tests/spectate-domain-macros.test.js` — **12/12 passing** (backend untouched; run to confirm no regression).
- `cd concord-frontend && npx eslint "app/lenses/spectate/page.tsx" "app/lenses/spectate/[worldId]/page.tsx"` — **0 errors, 1 pre-existing warning** (`MarketCard`'s unused `worldId` prop — confirmed pre-existing via `git stash` + re-lint against HEAD, not introduced by this pass).
- `cd concord-frontend && npx tsc --noEmit -p .` — clean for both touched files (no `spectate`-scoped errors in the full project-wide typecheck).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, matching the expected baseline; `spectate` does not appear in the `NO-BACKEND-CALL` list (only `narrative-walk` and `ux-suite` do), confirming it's still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `spectate`: `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false` (verified in `audit/ux-polish-honest.json`).
- `audit/` transient outputs reverted via `git checkout -- audit/` after grading — never committed.

**Wave 4 (2026-07-12) verification:**

- `cd server && node --test tests/contract/heartbeat-emits.test.js tests/world-event-scheduler.test.js tests/wave4-event-worldid.test.js` — **44/44 passing**.
- `cd server && node --test tests/embodied-faction-strategy.test.js tests/faction-cause-payload.test.js tests/event-shapes.test.js tests/synthetic-playtest.test.js tests/combat-impact-pvp-feel.test.js tests/socket-combat-damage-cap.test.js tests/combat-anti-cheat.test.js tests/conkay-macro-lifecycle.test.js` — **212/212 passing** (regression sweep of every test file that touches `applyMove`, `event-shapes.js`, or the socket combat path).
- `cd server && node --check server.js lib/embodied/faction-strategy.js emergent/faction-strategy-cycle.js lib/event-shapes.js` — clean.
- `cd server && npx eslint server.js lib/embodied/faction-strategy.js emergent/faction-strategy-cycle.js lib/event-shapes.js tests/contract/heartbeat-emits.test.js tests/world-event-scheduler.test.js tests/wave4-event-worldid.test.js` — **0 errors, 0 warnings**.
- `cd server && node --test tests/boot.test.js` — boots clean.
- `cd concord-frontend && npx vitest run tests/lenses/spectate-page.test.tsx tests/lenses/spectate-worldid-ticker.test.tsx tests/spectate-worldid-page.test.tsx` — **15/15 passing**.
- `cd concord-frontend && npx eslint "tests/lenses/spectate-worldid-ticker.test.tsx" "app/lenses/spectate/[worldId]/page.tsx"` — 0 errors, the same 1 pre-existing `MarketCard` warning (not introduced by this pass).
- `cd concord-frontend && npx tsc --noEmit -p .` — **0 errors project-wide**.
- `node scripts/verify-lens-backends.mjs` — unchanged: `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260.
- Note: `app/spectate/[worldId]/page.tsx` (a separate, older route outside
  `app/lenses/`, covered by `tests/spectate-worldid-page.test.tsx`) has no
  live event ticker at all and was unaffected by this pass — confirmed by
  reading it in full before excluding it.
