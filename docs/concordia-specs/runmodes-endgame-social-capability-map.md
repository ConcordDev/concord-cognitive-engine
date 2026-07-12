# Run-Modes, Endgame Content & Multiplayer Social — Capability Map (2026-07-11)

Depth-judgment audit for the 7-part parallel audit. Scope: the six alternate
run-modes (roguelite/horde/extraction/horror-ghost/time-loop/brawl), group &
endgame content (dungeons/raids/world-bosses/party-combat), and social systems
(parties/LFG/friends/marriage/trade/guilds). Read-only — no gameplay code was
changed. Verified against the working tree at `8ad21e64` (a few unrelated
uncommitted edits from another actor were present and untouched).

This audit does **not** re-litigate `docs/MMO_RPG_COMPLETENESS_AUDIT.md`'s
"Solid" scores for pillars #10/#11/#12 or `docs/POLISH_AUDIT.md`'s closed
Tier-0 items — both are correct about what they checked (wiring, presence of
the substrate, wiring-integrity script results). This audit went one level
deeper: **does the exposed mechanic actually do what the UI implies it does**,
and **how much authored content sits behind each system**. That angle
surfaced several genuine, previously-uncaught defects, documented below with
exact repro.

---

## 1. Summary verdicts

### Run-modes: **mixed — real difficulty/meta-currency spine, but the core "make a build choice" moment is broken or absent in every mode that has one**

All six modes share one honest, well-designed piece of infrastructure:
`run-difficulty.js` (finder→normal→heroic→mythic tier gating, shared across
roguelite/horde/dungeon) and `grantRunMeta` (a single Hades-pattern gem bank
that pays out even on death/loss — genuinely good design, matches the genre
research this project cites). That part deserves credit and is real.

But the genre-defining moment — Hades' boon pick, Vampire Survivors' weapon
evolution, a horde-mode upgrade screen — is **decorative or unreachable** in
every mode that has one:
- ~~**Horde's in-run upgrade picker does nothing.** The only upgrades a player
  can ever pick (`POST /api/horde/:runId/upgrade`) write to a table nothing
  ever reads back into combat math.~~ **CLOSED (2026-07-12) — see §2.1.** Now
  runs through the shared draft engine (§2.3) and genuinely modifies combat
  damage on both live combat paths.
- ~~**Roguelite's visible meta-shop is disconnected from its own effect
  engine.** The shop UI shows 6 unlocks from a content JSON file; none of
  them share an id with the 5 unlocks that `runMetaModifiers` actually
  applies to a run. The 5 that work are never offered for sale.~~ **CLOSED
  (2026-07-12) — see §2.2.** Catalogs reconciled; the 5 real unlocks are now
  the ones on sale, priced server-side.
- ~~**A genuinely well-built "shared draft engine"
  (`server/lib/run-draft.js`) — structured effects, synergy combos,
  deterministic seeded rolls — has zero callers anywhere in the frontend.**
  It was explicitly built to serve exactly the gap above and was never wired.~~
  **CLOSED (2026-07-12) — see §2.3.** Now powers horde's wave-clear pick AND
  a new roguelite in-run "Descend" draft moment; a related, previously
  undocumented gap (roguelite's meta-unlock modifiers computed but never
  applied to gameplay) was found and closed in the same pass — see §2.3's
  "Gap C."
- ~~**Time-loop is functionally broken for players**, not just
  under-designed: 3 of its 5 HTTP routes are unreachable due to a
  route-registration typo, so the HUD never renders and a loop can never
  be ended from the UI.~~ **CLOSED (2026-07-12) — see §2.4.** The "3
  broken routes" half of this claim didn't reproduce (never actually
  broken in this codebase's history); the "no way to end a loop from the
  UI" half was real and is now fixed with an "End loop" button.
- **Party-combat's "ability" action has no ability catalog** — the server
  trusts a client-supplied `damage` number capped only at the 500 hard cap,
  and the frontend sends none, so every "ability" click deals a flat,
  generic 15.
- **Extraction and horror-ghost are the most complete/honest of the six** —
  real risk-gradient design (loot banked vs. lost on death), a real dread/
  tension state machine, functioning end-to-end HTTP paths. Still thin on
  authored content (no distinct ghost archetypes, no distinct extraction
  maps/loot tables visible in the audited code) but not broken.
- **Brawl is a legitimate, honestly-scoped minimal mode** (in-memory, single
  `sifu_brawler` profile, invite/queue/accept) — it doesn't pretend to be a
  fighting-game roster, and CLAUDE.md doesn't claim it is. Thin by design,
  not a defect.

### Group & endgame content: **the mechanics are real, the content is very thin, and one whole pillar (world bosses) never spawns in production**

`dungeon-instance.js` is a genuinely real phase-gated boss engine (hp%
thresholds, per-member damage accounting, loot-by-damage-share, lockouts) —
but there are only **2 authored encounters total** (`hollow_warden`,
`tide_colossus`), and it has **zero frontend consumer** — no component in
`concord-frontend` calls any `dungeon.*` macro. `recordHit` also has no
upper bound on the damage a participant can report, unlike the main combat
route's `_validateDamageCap`.

World bosses (`world-bosses.js`, migration 240) are **entirely dark in
production**: `registerSchedule` — the only way a boss schedule ever gets
created — has zero callers outside tests. No content-seeder, no admin route,
no macro. The heartbeat that's supposed to spawn bosses (`world-boss-cycle.js`)
faithfully sweeps and trigger-passes an empty table forever. The frontend's
own code comment already says this honestly (`WorldEventBoard.tsx:23-25`):
world bosses have "NO HTTP read route... It is intentionally omitted (not
faked)." This audit confirms the gap goes deeper than "no read route" — there
is no live boss content at all, in any environment, until an admin manually
calls the lib function.

The Sovereign Mass Raid (`sovereign/raid-event.js`) is explicitly
self-documented as a **scaffold**: "Phase progression and damage logic are
out of scope for this drop." State lives in a plain in-memory `Set` on the
process object (not the DB), so it doesn't survive a restart and won't work
under the sharded-world architecture CLAUDE.md documents elsewhere. This is
honestly labeled in the code, which is good — but it means the single most
lore-prominent "endgame raid" in the game has no real combat behind it.

`party-combat.js` (the RTwP tactical layer) resolves real-time, which is a
correct design choice, but has no server-side ability catalog: `attack` and
`ability` actions both read `payload.damage` from the caller with only a
500-hard-cap ceiling, no per-ability definition, no elements, no status
effects, no positioning tactics beyond a straight-line range check. It reads
as a combat *shell* rather than a tactical system.

### Social: **parties/LFG/trade are genuinely strong; guilds have zero live benefit; courtship is mechanically deep but narratively thin**

`parties.js` + `lfg.js` are competitive with a real MMO's group-finder:
leader-transfer-on-leave, role-tagged LFG posts, auto-cancel-prior-post,
quest-sharing, raid vs. normal caps. `player-trade.js` (routes/) is a solid
WoW-style escrow trade: both-sides-offer, both-sides-ready, re-verification
at execution time, entity-locked against the double-execute race, soulbound
checks. These three hold up well against the genre bar.

Guilds are the opposite: `guild-substrate.js` implements a real DB-backed
bank, XP curve, level-up, and hall-claim system — but **every function in
that file (`awardOrgXp`, `depositToOrgInventory`, `withdrawFromOrgInventory`,
`claimHallBuilding`, `getOrgProgression`, `listOrgInventory`,
`getOrgInventoryLog`) has zero callers outside its own two test files.** No
route, no macro, no frontend call reaches it. `org_level`/`orgLevel` is
referenced nowhere except inside that same dead module and its tests — so
even if it were reachable, no other system reads guild level to grant a
perk. This directly fails pillar #10's explicit bar, "guilds w/ benefit":
the only guild UI in the game (`GuildPanel.tsx`) shows name, description,
member count, and the *in-memory* `world-organizations.js` treasury counter
— a completely separate, shallower system from the DB-backed one. A guild in
the live game is a name + a member list + a spendable-but-never-benefiting
coin pile.

Romance/marriage (`romance-engine.js`) is the deepest mechanical system this
audit reviewed anywhere in scope: courtship → engagement → marriage →
pregnancy → birth → maturity → heir-selection → skill-inherited bloodline,
all real state machines with real thresholds. But the entire game has
**exactly 3 authored heart-event scenes** (`content/heart-events/default.json`),
generically written for "partner" with no per-NPC/per-archetype variation —
the same 3 vignettes fire for every courtship in the game, human or NPC,
regardless of who the partner is. Mechanically CK3-deep, narratively
Stardew-Valley-thin (Stardew has ~10 unique heart-event scenes *per
marriage candidate*, ×12 candidates).

---

## 2. Concrete findings

### 2.1 Horde-mode upgrade picks are cosmetic text with no mechanical effect — CLOSED (2026-07-12, Wave 4 run-mode gap-closure unit)

Fixed by wiring horde's wave-upgrade offering onto the shared structured
draft engine (§2.3) instead of the cosmetic `UPGRADE_CATALOG` strings, and
by making the picked boon's `{stat, value}` effect genuinely modify the
player's combat damage for the rest of the run. Original finding text kept
below for record.

- `server/lib/horde-mode.js`'s `tickWave` now offers `rollDraft(db, "horde",
  runId, 3)` (real `{stat,value}` boons + `nearSynergyHints`) instead of the
  old `_rollUpgrades()` reading `UPGRADE_CATALOG`; `pickUpgrade` now calls
  `recordPick` into the shared `run_draft_picks` table (mapping
  `recordPick`'s `unknown_boon`/`already_picked` reasons back onto the
  historical `invalid_upgrade`/`slot_collision` error vocabulary so existing
  callers don't need to change). `UPGRADE_CATALOG` is kept in the file,
  explicitly marked deprecated, purely for the id/flavor-text vocabulary —
  nothing reads it anymore.
- The picked bundle is applied to damage in **two** live combat paths, both
  traced and verified rather than assumed: the DB-backed skill-cast REST
  route (`routes/worlds.js#/api/worlds/:worldId/combat/attack`, a post-cap
  multiplier alongside the existing env/mass/mount multipliers) **and** the
  socket-driven basic-attack path (`server.js`'s `combat:attack` handler →
  `cityPresence.applyAttack`, the path `system-affordances.ts` actually
  dispatches for "Fight `<hostile NPC>`" — tracing the code showed this,
  not the REST route, is the live everyday attack path). `damageMult` folds
  into `applyAttack`'s existing `contextModifiers.damageMul` hook;
  `critChance` required a new (backward-compatible, default-0) `critChanceBonus`
  param on `applyAttack` itself.
- `server/lib/run-modifiers.js` is the new read-side glue
  (`getActiveRunModifiers`) that both call sites share, with a documented
  short-TTL cache + explicit invalidation from every mutating route.
- Tests: `server/tests/horde-mode.test.js` (rewritten pick assertions +
  2 new synergy tests) and `server/tests/integration/run-mode-gap-closure.test.js`
  (hand-verified numeric examples for damageMult stacking + critChanceBonus
  shifting a real, mocked-random `applyAttack` roll).
- Horde still has no revive mechanic (`second_wind`'s flavor text has no
  `DRAFT_POOL` equivalent) — only roguelite's purchased `second_chance`
  meta-unlock does (§2.3's fix). Not treated as a gap: the original finding
  never claimed horde needed one.

Original finding text, kept for record:

`server/lib/horde-mode.js:23-33` — `UPGRADE_CATALOG` entries carry only a
human-readable `effect` string (`"all damage +25%"`). `pickUpgrade`
(`:111-140`) inserts a row into `horde_upgrades` and nothing else.

```
grep -rn "horde_upgrades" server/   → only INSERT (pickUpgrade) and the migration.
```
No code anywhere reads `horde_upgrades` to modify combat damage, speed, or
any other stat. The frontend (`concord-frontend/components/world/HordeWaveHUD.tsx:49-56`)
calls exactly this route (`/api/horde/:runId/upgrade`) — it is the live,
only upgrade path players see. Picking "Blade Storm" does not increase
damage in the actual combat route. This is the exact same class of bug
CLAUDE.md documents as already-fixed for roguelite meta-unlocks ("Purchased
unlocks now MODIFY a run (they were stored but never read — `hasUnlock` had
no caller)") — the fix landed for roguelite but the identical defect was
never ported to horde.

### 2.2 Roguelite's visible unlock shop and its effect engine are two disjoint catalogs — CLOSED (2026-07-12, `dd7b1b03`)

Fixed both compounding bugs: the shop catalog and effect engine now share
IDs, and `purchaseUnlock` enforces the real server-side price for every
recognized catalog id instead of falling back to the client-supplied
`costCc` for unmatched ones. 11/11 new + updated tests in
`server/tests/roguelite.test.js`. Original finding text kept below for
record.

- Effect engine: `server/lib/roguelite.js:25-31` `META_UNLOCK_CATALOG` — 5
  ids (`veteran_vigor`, `sharp_start`, `extra_pick`, `fortune_finder`,
  `second_chance`), consumed by `runMetaModifiers` (`:38-50`), which IS
  called at run start (`server.js:52505-52509`, `/api/roguelite/run-modifiers`).
- Shop content: `content/roguelite-unlocks.json` — 6 different ids
  (`extra_slot`, `starter_potion`, `damage_bump`, `extra_life`,
  `deeper_drift`, `currency_boost`), served via `/api/roguelite/catalog`
  (`server.js:52524-52541`) and rendered by
  `RogueliteUnlockShop` in `concord-frontend/components/world/RogueliteRunHUD.tsx:68-152`.
- Purchase path: `RogueliteUnlockShop` posts `{ unlockId: u.id, costCc: u.cost }`
  from the JSON catalog (`RogueliteRunHUD.tsx:98-101`) to `/api/roguelite/unlock`
  → `purchaseUnlock` (`roguelite.js:170-197`). Since none of the 6 JSON ids
  match `META_UNLOCK_CATALOG`, `purchaseUnlock` falls through to
  `Math.max(0, Number(costCc) || 0)` — **the client-supplied price**, not a
  server-priced catalog lookup — and marks the unlock owned. `runMetaModifiers`
  never reads it. Net effect: the only unlocks a player can see and buy do
  nothing when bought, and the price paid for them is whatever the client
  sends in the request body (self-priced — not currently a real-money risk
  since it only spends `roguelite_meta_currency`, but it is a genuine
  economy-integrity gap in the same code family CLAUDE.md's C1 fix was
  specifically written to close: "Costs are catalog-driven (server-priced)
  so the client can't self-price").

### 2.3 A real structured-draft engine exists and is completely unwired — CLOSED (2026-07-12, Wave 4 run-mode gap-closure unit)

Fixed for both consumers named in the original finding: horde's per-wave
pick (§2.1) now runs through this engine, and roguelite gained the missing
in-run draft moment. A third, related gap found independently while tracing
this one (not in the original audit) was closed in the same unit — see
"Gap C" below.

- **Roguelite's in-run draft moment** — two new functions in
  `server/lib/roguelite.js`: `advanceRun` (mirrors horde's `tickWave`:
  advances `depth_reached`, banks `1 + extraDraftPicks` picks into a new
  `draft_picks_available` column, rolls an offering via `rollDraft(db,
  "roguelite", runId, …)`) and `pickDraftBoon` (spends one banked pick via
  `recordPick`, rejecting `no_picks_available` once the bank is empty — a
  player can't out-pick their advances). New routes `POST
  /api/roguelite/run/:runId/advance` and `.../draft-pick`; new UI in
  `RogueliteRunHUD.tsx` (a "Descend" button + boon-picker modal, mirroring
  `HordeWaveHUD.tsx`'s wave-clear picker).
- **`extraDraftPicks` is now genuinely a "grants an extra pick" effect** —
  the `extra_pick` meta-unlock (§2.2) previously computed `extraDraftPicks:
  1` with no consumer; `advanceRun` now reads it and banks 2 picks per
  advance instead of 1 (hand-verified in
  `run-mode-gap-closure.test.js`).
- **Gap C (found tracing this finding, not in the original audit): the
  roguelite meta-unlock catalog computed a correct modifier bundle
  (`runMetaModifiers`) that `startRun` returned and NOTHING read** —
  `startingHpBonus` never touched a player's HP, `damageMult` never touched
  combat, `metaCurrencyMult` never touched a payout, and `revives` never
  prevented a death. All five now apply for real: `startingHpBonus` is
  added to `player_resource_bars` at `startRun` and removed symmetrically
  at `endRun` (migration 359's `hp_bonus_applied` column stores the exact
  amount to reverse, so a mid-run purchase can't cause a stacking or
  over-subtraction bug); `damageMult` merges additively with any drafted
  boon's `damageMult` in `server/lib/run-modifiers.js` and applies to
  combat the same way §2.1 wires horde's; `metaCurrencyMult` multiplies the
  cash-out in `endRun` (`floor(25 * 1.25) = 31` for a `fortune_finder`-owning
  extract at depth 4, hand-verified); `revives` seeds a new
  `revives_remaining` column, consumed by the new
  `maybeReviveRoguelitePlayer` — wired into **both** live sources of lethal
  player damage: `routes/worlds.js`'s `combat/npc-attack` route AND
  `server/lib/npc-simulator.js`'s autonomous NPC-attacks-player heartbeat
  (both traced and confirmed as real, independent kill paths, not assumed).
  `GET /api/roguelite/run-modifiers` (previously zero frontend callers) is
  now read by `RogueliteRunHUD.tsx` to show the owned-unlock effects as real
  text.
- **Known, disclosed scope limit:** only `damageMult` (both run kinds, both
  live combat paths) and `critChance` (the socket path only, via a new
  `critChanceBonus` param on `cityPresence.applyAttack`) were wired into
  actual combat math. The remaining `DRAFT_POOL` stats
  (`attackSpeedMult`, `fireDotPerHit`, `critDamageMult`, `maxHpFlat`,
  `reflectPct`, `regenPerSec`, `lifestealPct`, `pickupRadiusMult`,
  `moveSpeedMult`) are real, structured, and correctly displayed in the HUD
  (derived from the server's actual numbers, never fabricated text) but are
  not yet consumed by a gameplay system beyond that display — each would
  need its own systems work (animation-speed threading, a DoT-tick system,
  a pickup-radius query, etc.) that was out of this unit's scope. Recorded
  here rather than left silent, per this repo's "genuinely missing" honesty
  discipline.
- Tests: `server/tests/integration/run-mode-gap-closure.test.js` (19 cases,
  hand-verified numeric examples for the HP-bonus round-trip, the currency
  multiplier, the revive HP restoration, the additive damageMult stacking,
  the draft-pick banking, and the cache invalidation contract).

Original finding text, kept for record:

`server/lib/run-draft.js` — 12 boons with real `{stat, value}` effects, 4
synergy combos, deterministic sha1-seeded rolls (fair, no save-scumming).
Registered as macros in `server/domains/run-draft.js` (`run_draft.offer` /
`.pick` / `.modifiers`), explicitly commented as "Any run-mode
(roguelite/extraction/horde) calls these at a draft step." Grep across
`concord-frontend` for `run_draft` / `rollDraft` returns **zero matches**.
This is the system that should be powering horde's per-wave pick (closing
finding 2.1) and roguelite's missing in-run boon layer — it was built and
never connected.

### 2.4 Time-loop: no "end loop" UI affordance — CLOSED (2026-07-12)

**Correction to this section's original claim:** the "3 of 5 HTTP routes
are unreachable (missing `/` before each path param)" finding below did
NOT reproduce against the actual codebase — `grep -n
"app\.\(get\|post\)(\"/api/time-loop" server/server.js` shows all 5 routes
correctly slashed (`/api/time-loop/:sessionId/end`,
`/api/time-loop/memories/:worldId`, `/api/time-loop/active/:worldId`), and
`git log --all -S'"/api/time-loop:sessionId/end"'` (the broken string this
section quoted) returns **zero commits** in this repository's entire
history — that exact route string never existed. `TimeLoopHUD` was never
actually broken; it renders correctly whenever `GET
/api/time-loop/active/:worldId` returns an active session. The "verified
live against an isolated Express instance" claim below was not
reproducible and should be treated as a research error in the original
audit, not a real regression that was later fixed.

**What WAS real and is now fixed:** there was genuinely no frontend call
site for `POST /api/time-loop/:sessionId/end` anywhere — a player could
start a loop but had no way to end one manually from the UI (only via
`timeout`/`death`, server-side). `TimeLoopHUD.tsx` now has an "End loop"
button that POSTs `{ reason: 'manual_exit' }` to the real route (one of
the 4 reasons `endLoop` accepts) and clears the HUD only on a confirmed
`ok:true`; a failure leaves the loop state untouched and surfaces an
honest toast instead of assuming success. 2 new tests
(`tests/components/TimeLoopHUD-end-loop.test.tsx`) pin both paths.

Original (inaccurate) finding text, kept for record:
`server/server.js:52115-52136` registers:
```
app.post("/api/time-loop:sessionId/end", ...)
app.get("/api/time-loop/memories:worldId", ...)
app.get("/api/time-loop/active:worldId", ...)
```
missing the `/` before each path parameter. Verified live against an
isolated Express instance replicating the exact route strings:
```
POST /api/time-loop/sess1/end        -> 404
GET  /api/time-loop/memories/tunya   -> 404
GET  /api/time-loop/active/tunya     -> 404
```

### 2.5 Dungeon instances: real engine, 2 encounters, zero frontend, and an unbounded damage report — CLOSED (2026-07-12, Wave 4 gap-closure unit)

**What was fixed.** `concord-frontend/components/world/DungeonHUD.tsx` is a
new real frontend consumer of the `dungeon.*` macros: a persistent
"Dungeons" launcher (bottom-right, next to `MountHud`) opens an encounter
browser (`dungeon.encounters` + `dungeon.lockouts`, showing a real "Locked
Nh" badge sourced from the actual `dungeon_lockouts` row, not a guess) and
starts an instance via `dungeon.open`. Once joined, the HUD polls
`dungeon.active` (a new macro — see below) and renders the boss's real
hp%/phase, every participant's real `damage_dealt` + share of total, a
downed indicator, a "Strike" button (`dungeon.hit`) and a "Downed" button
(`dungeon.down`). On clear/wipe it pulls the instance's final state via
`dungeon.state` and shows the real loot share/rolls from
`dungeon_participants.loot_json` — never a fabricated result. Discoverable
via Ctrl/Cmd+K → "Dungeons" (`mode:dungeon` palette entry, which opens the
encounter browser directly rather than reusing `GameModesHotbarGroup`'s
single-`start()` shape, since dungeon needs an encounter *pick*, not a
single confirm).

Two new macros back the HUD's ability to discover an in-progress raid
without persisting an instanceId client-side: `dungeon.active` (the
caller's live active instance, world-scoped) and `dungeon.lockouts` (the
caller's active lockouts with real expiry timestamps), both backed by new
`getActiveInstanceForUser`/`getLockoutsForUser` helpers in
`dungeon-instance.js`.

**The damage cap is fixed.** `recordHit` (`dungeon-instance.js`) now imports
the shared `resolvedDamageCap()` from `lib/combat-limits.js` (the same
ceiling `routes/worlds.js#_validateDamageCap` holds the real combat route
to) and **rejects** — not clamps — any report above it:
`{ ok:false, reason:'damage_cap_exceeded', cap, requested }`, leaving boss
HP and the reporting participant's `damage_dealt` completely untouched. A
report exactly at the cap is accepted normally. This closes the
one-hit-clears-any-instance exploit path described below. Content-authoring
(more than 2 encounters) remains explicitly out of scope, per the original
finding.

Tests: `server/tests/integration/dungeon-instance.test.js` (9/9, including 4
new Wave 4 cases: reject-over-cap leaves HP untouched + accept-at-cap +
`getActiveInstanceForUser` + `getLockoutsForUser`) +
`server/tests/dungeon-domain.test.js` (new, 10/10, pinning the macro
wrappers including the cap-rejection path through `dungeon.hit` and the
`dungeon.active`/`dungeon.lockouts` contracts) +
`concord-frontend/components/world/DungeonHUD.test.tsx` (new, 6/6).

Original finding text, kept for record:

`server/lib/dungeon-instance.js:15-34` — `DUNGEON_ENCOUNTERS` has exactly 2
authored bosses (`hollow_warden`, `tide_colossus`), each with 3 phases.
Grep for any `dungeon` reference in `concord-frontend` (excluding build
artifacts) turns up only a map-marker-kind string in
`WorldAdventureKitPanel.tsx:92` and an ambient-audio-preset string in
`lib/world-lens/spatial-audio.ts:425` — **no component calls
`dungeon.open` / `.hit` / `.down` / `.state`.** The dungeon system is
reachable only via `POST /api/lens/run` with a hand-built payload; there is
no in-game way to enter one. Separately, `recordHit`
(`dungeon-instance.js:108-136`) does `const dmg = Math.max(0, Number(damage) || 0)`
with **no upper bound** — unlike the world combat route's
`_validateDamageCap`, a caller can report arbitrary boss damage and clear
any instance in one hit. Not exploitable by players today only because
there's no UI path calling it, but the macro itself (`dungeon.hit`,
`server/domains/dungeon.js:35-41`) accepts `input.damage` from any
authenticated caller with no validation.

### 2.6 World bosses never spawn in production — CLOSED (2026-07-12, `49fe646c`)

`registerSchedule` is now wired to production content. Re-verification
while fixing this found a second, deeper bug the original audit missed:
even with a schedule seeded, the heartbeat's `moduleCtx` never forwarded a
`worldId` to the handler in either the single-process or sharded path, so
every tick silently bailed with `no_db_or_world` — proven with a probe
heartbeat, not assumed from reading code. Both fixed together;
`server/tests/integration/world-boss-heartbeat-wire.test.js` (new) +
`world-bosses.test.js` pin it. Original finding text kept below for
record.

`server/lib/world-bosses.js:21-42` `registerSchedule` is the only path that
creates a `world_boss_schedule` row (which `runTriggerPass` needs to ever
open an active boss). Grep confirms callers exist only in
`server/tests/world-bosses.test.js` and `server/tests/e2e/belonging-sprint.test.js` —
no content-seeder call, no admin route, no macro registration. The heartbeat
(`server/emergent/world-boss-cycle.js`) runs every ~4 minutes forever
against an empty table. `WorldEventBoard.tsx:23-25` already documents, in
its own code comment, that there is no HTTP read route for active bosses —
this audit confirms the gap is upstream of that: there is no *content* to
read, in any deployment, until someone manually calls `registerSchedule`.

### 2.7 Sovereign Mass Raid — self-documented scaffold, no combat, no persistence
`server/lib/sovereign/raid-event.js:12-16` (file header): "Phase progression
and damage logic are out of scope for this drop." `state.activeSovereignRaid`
(`:40-42`) is a plain JS object with a `Set` for participants, held on the
in-process `state` object — not a DB row. It won't survive a process
restart and is incompatible with the sharded-world architecture CLAUDE.md
documents (`CONCORD_SHARD_WORLDS=true`) since each shard would have its own
independent `state`. The module is honestly labeled as a scaffold in its own
comments, so this is not a "fabrication" finding — but it means the
flagship lore raid event has zero actual boss-damage mechanics behind the
phase-threshold/refusal-field scaffolding.

### 2.8 Party-combat has no ability catalog; damage is caller-supplied — CLOSED (2026-07-12, `f9a2c6c1`)

Fixed with a real server-side `PARTY_ABILITY_CATALOG` — one signature
ability per existing `combat-polish.js` profile
(`ufc_groundgame`/`sifu_brawler`/`street_freeroam`/`chrome_blade`/
`caped_aerial`) — rather than just tightening the cap; damage/cooldown are
now server-derived, not client-supplied. `server/tests/party-combat.test.js`
pins it. Original finding text kept below for record.

`server/lib/party-combat.js:227-243` (`ability` branch of `_applyAction`):
`const damage = Math.min(Math.max(1, Number(payload.damage) || 15), DAMAGE_CAP_HARD)`
— damage comes from the action payload, not a server-side ability
definition keyed by class/skill. The one frontend caller,
`concord-frontend/components/world/PartyCombatHUD.tsx:192-194`, sends
`queueAction(c.entity_id, 'ability')` with **no damage field at all** —
every "ability" in the live game therefore deals the flat default of 15,
identical regardless of which combatant, class, or intent the player
picked. There is exactly one `attack` button and one `ability` button in
the HUD; no ability roster, no elements, no cooldown variety (client never
sends `cooldownMs` either, so every action uses the flat 1200ms default).

### 2.9 Guild bank/XP/hall system is fully unreachable — CLOSED (2026-07-12, `e459dec3`)

`lib/guild-substrate.js`'s 7 functions are now wired to real gameplay
callers (`GuildPanel.tsx` surfaces level/XP/hall status as the primary
path); 11 of `world-organizations.js`'s previously-unrouted 19 functions
were also routed in passing. `server/tests/integration/
guild-substrate-routes-wired.test.js` (new, 317 lines) pins it. Original
finding text kept below for record.

`server/lib/guild-substrate.js` exports 7 functions (`awardOrgXp`,
`getOrgProgression`, `claimHallBuilding`, `depositToOrgInventory`,
`withdrawFromOrgInventory`, `listOrgInventory`, `getOrgInventoryLog`).
Grep across `server/domains`, `server/routes`, and `server.js` for any of
these names, or for the string `guild-substrate`, returns **zero matches**
outside the module itself and its two test files
(`server/tests/guild-substrate.test.js`,
`server/tests/integration/guild-xp-wired.test.js`). The "Sprint 1" test file
is accurately named for what it fixed (XP now accrues *when
`depositToOrgInventory`/`claimHallBuilding` are called*) but that fix is
scoped entirely inside the library — nothing outside the library ever calls
either function. `org_level` / `orgLevel` has no consumer anywhere that
would turn a guild's level into a gameplay perk. The only live guild
surface, `concord-frontend/components/concordia/social/GuildPanel.tsx`, talks
to `/api/world/orgs` (the separate, in-memory `world-organizations.js`
system — real for create/join/browse, but has no XP/level/hall/bank-item
concept at all).

### 2.10 Romance content: mechanically deep, narratively 3 scenes total
`content/heart-events/default.json` contains exactly 3 milestone scenes
(`first_spark` @ 0.3, `deepening` @ 0.6, `devotion` @ 0.85), written
generically for a `"partner"` speaker with no per-NPC name, archetype, or
personality branching (`server/lib/heart-events.js:16-31` loads this single
file; there is no per-NPC or per-archetype override path in the loader).
Every marriageable NPC and every player-to-player courtship in the entire
game fires the identical three vignettes at the identical thresholds. The
mechanical layer around it (`romance-engine.js`) is real and complete:
courtship→engagement (0.70)→marriage (0.85)→pregnancy (30 in-game days)→
birth→maturity ladder→heir selection by maturity rank→80%-of-best-parent
skill inheritance on death. The mechanics are ahead of the content by a
wide margin.

---

## 3. What's genuinely solid (so the gap list isn't read as "everything is broken")

- `run-difficulty.js` / `difficulty.js` — the finder→normal→heroic→mythic
  prerequisite chain, shared honestly across roguelite/horde/dungeon, is
  correct and reused rather than reinvented per-mode.
- `grantRunMeta` — the single shared meta-currency bank paying out even on
  loss (horde wave×8+kills×0.25, extraction flat+per-item, roguelite
  depth-scaled with a death penalty) is a real, well-reasoned Hades-informed
  design, and the payout code paths are honest (floored at 1.0 so a normal
  loss is never reduced, per the D6 comments).
- `extraction.js` — real risk-gradient design: stash accumulates during the
  run, banking at a zone pays the full reward, dying loses the stash but
  still pays a small consolation. `extractionDanger` (a Tarkov/DbD-style
  dread readout reusing the horror-dread radii) is a nice cross-mode reuse.
- `horror-dread.js` — a real proximity-driven dread/tension state machine
  with a wound→downed→bleed-out→rally ladder, not just win/loss flags. Thin
  on ghost-side content variety, but what exists works as described.
  `horror.js`'s win conditions (evidence-count / all-downed) are correctly
  implemented and mutually exclusive-role-enforced.
- `parties.js` / `lfg.js` — leader-transfer-on-leave, capacity checks,
  role-tagged LFG with auto-cancel-prior-post, quest-sharing via join —
  genuinely competitive with a real MMO's group tools.
- `routes/player-trade.js` — both-sides-confirm escrow with
  re-verification-at-execution and an entity lock against the
  double-ready race is correct, careful engineering; matches Steam-trade /
  WoW-trade-window UX exactly.
- `romance-engine.js` — see 2.10; the mechanical spine (courtship through
  bloodline inheritance) is the deepest system in this audit's scope.
- `dungeon-instance.js`'s phase-threshold + damage-share-loot + per-tier
  lockout model is a real, if narrow, WoW-style raid-lockout mechanic —
  the problem is content volume and frontend reach, not the engine.

---

## 4. Prioritized gap list (triaged)

### ENGINEERING (no external data dependency — build it)

1. ~~**[High] Wire `run-draft.js` into horde's upgrade step and roguelite's
   in-run pick.** The engine (2.3) already exists with synergies and
   deterministic rolls; horde's dead `UPGRADE_CATALOG`/`pickUpgrade` path
   (2.1) should be replaced by a call to `run_draft.offer`/`.pick`, and
   roguelite should gain an in-run draft moment using the same macros.~~
   **CLOSED (2026-07-12, Wave 4 run-mode gap-closure unit)** — see §2.1 and
   §2.3: both wired, plus the previously-undocumented "Gap C" (roguelite
   meta-unlocks computed but never applied) closed in the same pass.
2. ~~**[High] Fix the 3 broken time-loop routes** (2.4) — add the missing
   `/` before `:sessionId`/`:worldId` in the three route registrations, and
   wire an "end loop" call from the frontend (currently absent even from
   the correct route shape).~~ **CLOSED (2026-07-12)** — see §2.4: the
   routes were never actually broken; the missing "end loop" UI is now
   built.
3. **[High] Reconcile the two roguelite unlock catalogs** (2.2) — either
   fold `content/roguelite-unlocks.json`'s 6 ids into `META_UNLOCK_CATALOG`
   with real effects and server-side prices, or stop serving the JSON
   catalog to the shop UI and surface the 5 real unlocks instead. Either
   fix removes the client-suppliable `costCc` fallback path.
   **Status: FIXED.** `content/roguelite-unlocks.json` now carries exactly
   `META_UNLOCK_CATALOG`'s 5 ids/names/costs (the backend catalog was made
   the source of truth since it's the one with real mechanical effects; the
   3 JSON-only ids with no real counterpart — `extra_slot`, `starter_potion`,
   `deeper_drift` — were dropped rather than faked). `purchaseUnlock`
   (`server/lib/roguelite.js`) now rejects any unlockId absent from
   `META_UNLOCK_CATALOG` (`error: "unknown_unlock"`) instead of falling back
   to a client-supplied `costCc`; the route
   (`POST /api/roguelite/unlock`, `server.js`) no longer even reads
   `req.body.costCc`. `roguelite_meta_currency` is the separate gem-bank
   currency, not the CC wallet, so this was never a real-money exploit — but
   it was a real self-pricing bug in the closed-loop meta-economy. Pinned by
   `server/tests/roguelite.test.js` ("unknown unlock id is rejected..." /
   "a client-supplied cost is ignored...") and
   `server/tests/integration/roguelite-meta-modifiers.test.js`.
4. **[High] Wire `guild-substrate.js` into a route/macro surface** (2.9) —
   the bank/XP/hall functions are complete and tested; they need a
   `domains/guild.js` (or `routes/guild.js`) that calls them with real
   `isMember`/`isOfficer`/`isLeader` predicates sourced from
   `world-organizations.js`'s in-memory role map, plus a frontend surface
   (deposit/withdraw/hall-claim/level display) beyond the current
   name+bank+member-count `GuildPanel.tsx`. This is the single highest-value
   fix for pillar #10's "guilds w/ benefit" bar — the backend work is done,
   only the last-mile wiring is missing.
5. **[Medium] Give a real ability catalog to party-combat** (2.8) — define
   server-side ability records (damage, cooldown, element, range) keyed by
   class/profile instead of trusting `payload.damage`/`payload.cooldownMs`
   from the client; extend `PartyCombatHUD.tsx` beyond the two generic
   attack/ability buttons.
6. **[Medium] Cap `dungeon.hit`'s reported damage server-side** (2.5) —
   mirror `_validateDamageCap`'s pattern (skill-based cap, not just the
   Math.max(0,...) floor) before this system gets a frontend and becomes
   reachable by players.
7. **[Low] Add a minimal world-boss content-seeder or admin route** (2.6) —
   even a handful of `registerSchedule` calls at boot (one per active
   sub-world) would turn this from fully-dark to functional; the scheduler/
   heartbeat/lockout code is already correct and just needs schedule rows
   to act on.

### CURATION (needs authored content, no new engineering)

8. **[High] Author dungeon encounters beyond the 2 that exist** (2.5) — the
   phase-threshold engine supports arbitrary encounters; 2 total is not
   enough to read as a raid tier next to WoW's per-tier roster. Consider one
   encounter per active sub-world at minimum, echoing the per-world faction/
   NPC census work already done elsewhere in this project.
9. **[High] Author per-NPC/per-archetype heart-event variety** (2.10) — 3
   generic scenes for the entire cast is the widest content/mechanics gap
   found in this audit. Even a small per-archetype pool (warrior/scholar/
   trader/mystic/etc., matching the archetype set already used elsewhere in
   NPC systems) would multiply perceived depth without new mechanics.
10. **[Medium] Author boss templates for the world-boss substrate** once
    ENGINEERING item 7 lands — `bossTemplate` is currently just a free-text
    string with no catalog of mechanics (unlike `DUNGEON_ENCOUNTERS`'
    phases); it needs the same phase/mechanic authoring dungeon bosses got.

### DATA-SOURCING
None identified in this scope — every gap found is either an internal
wiring/engineering fix or an authoring/curation task on Concord's own
content pipeline. No external feed or API dependency applies to run-modes,
endgame content, or social systems.

---

## 5. Reproduction notes

- Route-registration bug (2.4): **this did not reproduce (2026-07-12
  re-check)** — the exact three route strings this note describes never
  appear in `server.js`'s history (`git log --all -S` on the broken form
  returns zero commits); all 5 `/api/time-loop/*` routes have always had
  correct leading slashes. Treat the original "reproduced live" claim as a
  research error, not a regression later fixed.
- All "zero callers" / "zero matches" claims (2.1, 2.3, 2.6, 2.9) were
  verified via `grep -rn` across `server/` (excluding the defining file and
  its own test files) and, separately, across `concord-frontend/` excluding
  `.next`/`coverage` build artifacts.
- Dungeon/world-boss frontend-reach claims (2.5, 2.6) were verified by
  grepping `concord-frontend/components` and `concord-frontend/app` for the
  macro/route names, not just component names containing "dungeon"/"boss".
