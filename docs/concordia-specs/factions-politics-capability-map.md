# Factions, Politics & Governance — capability map

Audited 2026-07-11 against live code (not docs). Scope: the faction-strategy
CK3-style state machine (Layer 11), realm/kingdom decree governance, the
CK3-parity dynasty/diplomacy/war macro layer, council/deliberation tooling,
and authored faction content across all 9 sub-worlds. Benchmarked against
Crusader Kings 3 (deep multi-actor political simulation — stances, opinion
modifiers, plots, succession) and Baldur's Gate 3 (faction reputation with
real narrative weight and consequence).

## 1. Summary verdict

**Two genuinely-real, only loosely-linked political substrates coexist,**
plus a large body of excellent authored flavor text sitting on top of a
mechanically shallower-than-advertised simulation:

1. **Layer 11 faction-strategy** (`server/lib/embodied/faction-strategy.js`
   + `server/emergent/faction-strategy-cycle.js`, migration 117) — an
   autonomous, world-persistent state machine every authored faction runs on
   a ~50-minute heartbeat. **This is the system CLAUDE.md and the two prior
   audit docs are actually arguing about (T3.1, resolved below — fixed).**
   It compounds real signals (leader coping-trait bias, structural strength
   from a player-ruled realm's tax/treasury/legitimacy/conscription,
   collapse-cascade contagion) into wars, truces, and alliances — but its
   pairwise-relation awareness inside `pickMove` is **dead code** (a stub
   always returns `0` — see §4), which quietly breaks both alliance
   formation and war-target relevance. Net: closer to a "biased random walk
   over 6 stances with some real teeth (structural strength decides who
   wins)" than to CK3's opinion-modifier web, but genuinely NOT the "thin
   6-state loop" a skeptical read alone would suggest — the structural-
   strength + collapse-cascade + player-ruler-governance-feeds-in machinery
   is real depth CK3 fans would recognize.
2. **The CK3-parity macro layer** (`server/domains/kingdoms.js`, 24 of its
   36 macros: dynasty/succession, council, diplomacy, war, economy,
   intrigue, law) — this is a genuinely CK3-shaped feature set (char_marry,
   dynasty_tree, treaty_propose, claim_fabricate, scheme_start,
   war_declare...) and the frontend (`DynastyRealmManager.tsx`, 958 LOC) is
   real and correctly wired end-to-end (confirmed in
   `docs/lens-specs/kingdoms-capability-map.md`, independently re-verified
   here). **But it runs on `globalThis._concordSTATE.kingdomsLens`
   per-player in-memory Maps, not the DB** — it's a private CK3-flavored
   sandbox for one player, not a shared political fabric other players
   observe or that feeds back into Layer 11's faction-strategy state. Two
   real systems, not one deep one.

**Player agency verdict:** the player is **not** a pure bystander (the T3.1
question), but almost all of their leverage over faction politics is
**indirect**, funneled through realm rulership (tax/conscription decrees →
structural strength → who wins the autonomous war/raid rolls) rather than
direct diplomatic action on behalf of a faction. There is no macro to
propose an alliance, declare a war, or sabotage a stance on a faction's
behalf — only to witness, bet on, rule over, or (in principle, but
practically unreachable — see §3) fight in one.

**Authored content is a genuine strength.** 77 factions across 9 worlds
(§6) carry distinct, specific, often morally-shaded goals — this is not
reused-template writing. It is the strongest single piece of evidence for
"this reads as politics" and the weakest link is turning that writing into
mechanics that let a player actually push on it.

## 2. T3.1 resolved: FIXED, with direct code evidence

`docs/POLISH_AUDIT.md`'s T3.1 claim ("fully dark — macros exist, no .tsx
consumer, no socket emit") is **stale**. It was true when written
(2026-05-29) and was fixed in a later sprint the CLAUDE.md "ConKay
prod-audit" line references. Confirmed by reading the actual code, not
the docs:

- **The emit exists and is unconditional, not gated behind a flag.**
  `server/emergent/faction-strategy-cycle.js:105-110`:
  ```js
  io?.emit?.("faction:strategy-move", {
    factionId: f.faction_id,
    move: applied.move,
    target: applied.target ?? null,
    ts: Date.now(),
  });
  ```
  fires for **every** successfully applied move (not just wars/raids) —
  the preceding comment even says so explicitly: *"Surface the (previously
  dark) CK3-style stance machine: every strategic move ... emits a
  lightweight event so the EmergentEventFeed can show 'the world's
  factions are scheming'."* Three more targeted events fire from
  `applyMove` itself (`server/lib/embodied/faction-strategy.js:460-480`):
  `faction:war-declared`, `faction:alliance-formed`, `faction:truce-sought`.
  A fifth, `faction:collapse-cascade`, fires from the cycle's contagion
  pass (`faction-strategy-cycle.js:175-180`).
- **A real .tsx consumer exists and is mounted.**
  `concord-frontend/components/world/EmergentEventFeed.tsx:55-58,131`
  registers all five event names in its `TRACKED_EVENTS` table (channel
  `'faction'`, distinct labels), and the component is mounted in
  `app/lenses/world/page.tsx`. A second, purpose-built consumer,
  `concord-frontend/components/world/StrategicWarBanner.tsx`, renders a
  persistent top-of-screen ribbon ("⚔ N wars active") driven by
  `GET /api/factions/active-wars` + a `faction-war:*` realtime backstop.
  A third, `components/alliance/FactionWarIntel.tsx`, reads
  `/api/faction-war/active` for an intel panel. None of these are stubs —
  each renders real, live data with no fabricated fallback.

**Verdict: T3.1 is FIXED.** The player genuinely sees faction politics
happen — a war declaration, an alliance, a truce, a generic strategic move,
and (separately) a live "wars active" ribbon. What T3.1 did **not** claim,
and what remains true today (see §3), is that seeing is not the same as
steering: the player has no macro to directly cause any of these moves.

## 3. Does the player ever influence faction politics?

Four real, distinct levers exist — none of them is "call a macro that
directly changes a faction's stance/alliance," and one advertised pipeline
is dark in practice:

1. **Realm rulership → structural strength → war outcomes (real, and the
   deepest lever).** `server/lib/faction-strength.js#computeFactionStrength`
   reads a faction's linked `realms` row (migration 158, `realms.faction_id`
   — realms are seeded 1:1 from authored factions via
   `seedKingdomsFromFactions`, `server/lib/kingdoms.js:27`) and folds its
   `tax_rate`, `treasury`, `legitimacy`, and active `conscription` decree
   count into a `realmMult` in `[0.5, 2.5]` that multiplies the faction's
   base (leader-level + member-levels + headcount) strength. A player who
   takes over a realm as ruler (`kingdoms.takeover_conquest` /
   `_inheritance` / `_election`) and then issues decrees
   (`kingdoms.propose_decree`, `server/lib/kingdom-decrees.js`) is directly
   changing the numbers `resolveFactionClash` uses to decide who **wins** a
   `DECLARE_WAR`/`RAID` move the autonomous state machine picked on its own
   (`faction-strategy-cycle.js:125-149`). This is genuinely CK3-adjacent
   design — govern well and your faction is materially stronger in a
   simulation it doesn't otherwise ask your permission to run.
2. **Personal-stake routing (real, but narrative framing only).**
   `server/lib/personal-stake.js#scoreStake` checks the player's faction
   *reputation* (built from `character_opinions`, not from anything
   politics-specific) against an event's `factionId`/`targetFactionId` and,
   if allied/enemy, broadcasts a one-line "the faction you've stood with is
   on the move" / "a faction that despises you is stirring" beat. This
   makes the event feel personal; it doesn't let the player push back.
3. **Spectator betting (real, but zero agency).**
   `server/lib/betting-markets.js` lets players stake in-game SPARKS on a
   `faction_war` market resolving from `faction_strategy_state.kind`
   transitioning to `'war'` — parimutuel, substrate-is-the-oracle, no real
   money, no way to influence the outcome by betting.
4. **Join-and-fight-for-a-side combat (real code, effectively
   unreachable — a genuine gap).** `server/lib/combat/faction-war.js` +
   `server/routes/faction-war.js` is a complete system: it spawns NPCs on
   two sides, players who join slot into the regular `combat:attack` path,
   and their kills count toward `faction_wars.side_a_wins`/`side_b_wins`.
   **But `spawnFactionWar` has exactly one caller in the entire codebase
   outside its own module and tests: `POST /api/faction-war/spawn`, which
   its own route-file header comment labels "admin/test."** Grep confirms
   zero calls from `faction-strategy-cycle.js`'s `DECLARE_WAR`/`RAID`
   handling, zero calls from `world-event-scheduler.js`, zero calls from
   `world-events.js`'s 11 event types. Migration 301's own comment claims
   it's "a complete, wired producer... ticked inline in governorTick" —
   true for the *tick* (`tickAllFactionWars` does run on the heartbeat) but
   **not for the spawn**: nothing autonomous ever creates a joinable
   faction-war combat event. `StrategicWarBanner`/`FactionWarIntel` can
   only ever show "0 wars active" outside of an admin manually POSTing to
   `/spawn`. This is the single biggest "player agency" gap found — the
   wiring for a genuinely CK3-into-BG3 moment (autonomous political war →
   player physically fights in it) is 90% built and the last connector is
   missing.
5. **What does NOT exist:** no macro to directly propose an alliance,
   declare a war, sway a stance, bribe, or sabotage on a faction's behalf.
   `faction_strategy.witness_next_move` (`server/domains/faction-strategy.js`)
   is purely passive — it logs that the player was present, it does not
   let them affect the outcome. The player-created guild/org substrate
   (`server/lib/world-organizations.js`, `server/lib/guild-substrate.js`)
   is a real, separate system (create/join/ally orgs, guild halls, org
   treasuries) but has no linkage to the authored-faction political layer —
   a player guild cannot ally with or war against an authored faction.

## 4. Faction-strategy state machine — depth audit, with a real bug found

`pickMove` (`server/lib/embodied/faction-strategy.js:193-351`) is a
deterministic (seeded-hash RNG), 6-stance state machine
(`consolidate/expand/war/alliance/rebuild/isolation`) with 8 move types
(`PROCLAIM_EXPANSION/DECLARE_WAR/PROPOSE_ALLIANCE/SEEK_TRUCE/FORTIFY/
RAID/WITHDRAW/DECLARE_REBUILD`). Real depth signals, verified in code:

- **Leader personality biases moves.** `resolveLeaderCopingTrait`
  (`faction-strategy-cycle.js:45-58`) reads the faction leader's
  `npc_stress.coping_trait` (paranoid/reckless/cruel/withdraw/drink) and
  `biasFor()` nudges specific move probabilities — a paranoid leader is
  +25% more likely to RAID and −20% less likely to seek truce even at low
  momentum (`faction-strategy.js:211,224`).
- **War exit is momentum-gated, not a coin flip.** `truceThreshold =
  -0.6 + (biasFor("SEEK_TRUCE") * -1)` (line 224) — a faction only sues for
  truce once genuinely worn down, and a paranoid leader raises that bar.
- **Wars are structurally decided, not just narrated** — see §3.1's
  `resolveFactionClash`; a decisive strength gap produces a bigger momentum
  swing (`swing = 0.05 + margin*0.15`, capped at 0.20) and fires a
  `faction-war:clash` event with the real winner/loser/margin.
- **Contagion exists.** `collapseCascade` (gated by
  `CONCORD_COLLAPSE_CASCADE`) drags allies/patrons of a collapsed faction
  toward collapse too, applying a bounded momentum drag and firing
  `faction:collapse-cascade` — a real domino mechanic, not decorative.
- **Optional institutional-ethics bias** (`CONCORD_VIABILITY_ETHICS`) folds
  a value-rule-corpus-derived bias into the same additive seam, penalizing
  hostile moves / rewarding cooperative ones — off by default, so today's
  live behavior doesn't include it, but the seam is real.

**The confirmed bug: `pickMove`'s own relation-awareness is dead code.**
`server/lib/embodied/faction-strategy.js:516-522`:
```js
function getRelationScore(_a, _b) {
  // The applyMove caller passes in peerStates; pickMove gets relations
  // from the closure via setupCycle. For simplicity in pickMove we
  // assume peers carry their own relation snapshot. This helper is a
  // hook for tests that want to override.
  return 0;
}
```
This function is never overridden, monkey-patched, or passed as a
parameter anywhere in the codebase (`grep -rn "getRelationScore"` returns
only its own definition and its two call sites) — it is hard-coded to
return `0` in production. Its two call sites:
- Line 319 (`consolidate` stance): `peers.find(p => getRelationScore(...) >
  0.3)` — since the score is always `0`, `0 > 0.3` is always `false`, so
  the `friend` variable is always `undefined` and the entire
  `if (friend && rng() < ...)` `PROPOSE_ALLIANCE` branch **can never fire**.
  A faction can only ever *enter* `alliance` stance via the initial content
  seed (`seedFactionStrategyState`'s authored `allied_factions`/`alliances`
  arrays) — the live state machine has no path to form a *new* alliance
  once running.
- Line 292 (`expand` stance): `.find(p => getRelationScore(...) >= -0.3)` —
  since the score is always `0`, `0 >= -0.3` is always `true`, so this
  predicate is a no-op and `DECLARE_WAR`'s target selection is really just
  "first peer that's expanding or at war," **regardless of the actual
  relation** — the opposite of the module's own header comment ("expand →
  tension → war — when expand collides with another faction's territory")
  and opposite of what the inline comment at the call site claims
  ("only fires against an expanding rival whose relation is still >= -0.3").
  In practice two factions with a friendly `+0.45` truce relation can still
  roll into `DECLARE_WAR` against each other via this branch, and a
  genuinely hostile rival is no more likely to be picked than a neutral
  stranger.

This is a real, verified, previously-undetected defect (not covered by
`tests/embodied-faction-strategy.test.js`'s 19 cases — none of them
exercise the `friend`/`PROPOSE_ALLIANCE`-from-consolidate path or assert
real relation-gating on `DECLARE_WAR`'s target selection). **Not fixed in
this pass** — correcting it requires threading real per-pair relation data
from the cycle (which already has `db` and could look up
`faction_relations` per candidate pair) through `pickMove`'s `peers`
argument or `opts`, which changes a function signature multiple call sites
and tests depend on, and risks shifting the deterministic-RNG behavior
existing tests pin. That's beyond "small, low-risk" — flagged here as the
top ENGINEERING item instead (see §7).

**Compounding-into-politics verdict:** with the bug counted, this reads
less like "politics" and more like "biased random walk with a real combat
resolver bolted on" — wars start for structurally-irrelevant reasons
(any two expanding factions, unfiltered by relation) and heal via a
momentum threshold, alliances are static (seed-only), and the pairwise
relation table mostly just *records* what moves did rather than *steering*
future ones. The structural-strength and collapse-cascade layers are the
genuine, CK3-legible depth; the relation-driven stance transitions the
module's own comments promise are not actually happening.

## 5. Faction relations — expressive enough for real narratives?

`faction_relations` (migration 117) is a sorted-pair table:
`(faction_a < faction_b)` PK, `score` (−1..+1), `kind` ∈
`neutral|tension|truce|war|alliance|tribute`. Findings:

- **No decay.** Unlike `npc_grudges`/`pain_signals`/most other embodied
  substrates in this codebase, there is no heartbeat sweep that decays a
  relation score over time (`grep` across `server/emergent/*.js` and
  `server/lib/embodied/*.js` for `faction_relations` turns up only reads —
  `faction-strategy-cycle.js`, `npc-perception-snapshot.js` — and the one
  write path, `setRelation`, only called from `applyMove`). A relation only
  changes at fixed set-points a move explicitly writes (`DECLARE_WAR` →
  `score:-1,kind:'war'`; `PROPOSE_ALLIANCE` → `score:0.7,kind:'alliance'`;
  `SEEK_TRUCE` → `score:0,kind:'truce'`); it never drifts back toward
  neutral on its own. This is simpler than CK3's additive, per-source,
  independently-decaying opinion modifiers (no "why do they think this"
  breakdown is possible — there's one scalar, not a stack of reasons).
- **`tribute` is a dead enum value.** The CHECK constraint declares it
  (`server/migrations/117_faction_strategy.js:41`) but `grep` shows the
  only code that ever writes `"tribute"` is the unrelated CK3-parity
  `kingdoms.js` domain's `treaty_propose` macro, writing into its own
  in-memory `diplomacy` array, never into this table. `faction_relations`
  itself never reaches a `tribute` kind.
- **What it does support, honestly:** three legible narrative states
  (rivalry via `tension`, friendship via `truce`/`alliance`, open war) that
  the personal-stake system, `news-story-composer.js` (drives ambient news
  headlines off `tension_rising` transitions), and `spouse-reactivity.js`
  (a married NPC reacts differently to a spouse whose faction is at
  `war`/`tension` with the player's) all genuinely consume. It's real,
  legible, narrative-adjacent infrastructure — just shallower than a full
  opinion-modifier system, and (per §4) not reliably steering the state
  machine that's supposed to read it.

## 6. Authored faction depth — the strongest finding

Read all 77 factions across all 9 sub-worlds (`content/world/*/factions.json`).
**This is not template reuse with a different name swapped in.** Sample
breadth, quoted directly:

- **`sere/factions.json`** (11 factions, the standout) — a genuinely
  satirical late-capitalism political economy: `the_tessera` ("Continue.
  Not to win — winning would end the game and the game is the revenue. To
  keep every conflict on Sere unresolved, every productive realm
  extractable..."), `house_aldermere` (the bank every army banks with, so
  it profits from every war regardless of who wins), `the_tally_house`
  (controls the currency itself), `the_mercy_fund` ("arrive as rescue" —
  implying the crisis was arranged), `hollowford_seed` (a Monsanto-coded
  seed monopoly), `the_open_table` (the genuine opposition — building
  institutions outside the extractive system). These interlock as a single
  coherent critique, not 11 independent flavor blurbs.
- **`crime/factions.json`** — a five-faction ecosystem with real
  structural tension: an assassin network with a strict no-children/
  no-civilians code, a corrupt precinct, a white-collar embezzlement ring
  moving "30M annually," a federal RICO task force explicitly building a
  case across the other three, and a small principled PI agency that takes
  cases "the police won't and the federal task force can't be bothered
  with." The factions' goals actively constrain each other (the task force
  needs the other three to keep operating in order to build its case).
- **`cyber/factions.json`** — `zero_collective`'s `faction_state.tensions`
  is a genuine moral-ambiguity beat: *"Public services are measurably
  better when Kael's processes are running. Civil liberties are measurably
  worse. Most citizens are still net-positive on the trade."* This is
  BG3-tier "no clean answer" writing, not a mustache-twirling villain.
- **`fantasy/factions.json`** — `wildwood_circle`'s own `fears` includes
  "their own grief turning them into him" (the villain they're hunting) —
  internal psychological stakes, not just external goals.
- **`tunya/factions.json`** (14 factions, the largest set) — genuinely
  distinct cultural/political models per faction: `akeia_of_kahlay`
  (matriarchal monarchy, marriage as state-merger), `dormas` ("the
  inverted social hierarchy... keep the upper class invisible"), `nil`
  ("Hold the inner grove. Remember everything. Refuse to share most of
  it.") — not a single template with names swapped.

**Caveat, honestly stated:** this writing quality is real and does not
currently translate into mechanical depth. A faction's authored `goal`
(e.g. "recover the lost sister-city," "hunt the undead," "build a corpus
the federation can use") has **no mechanical hook** into `pickMove` — the
state machine's `PROCLAIM_EXPANSION`/`RAID`/`DECLARE_WAR` behavior is
identical regardless of whether the faction's authored goal is
territorial, ideological, or investigative. The `faction_state.tensions`
prose (internal faction conflict, e.g. Sere's Wildwood Circle split on
what to do about Thorne) is pure flavor — no macro reads it, no internal-
faction-split mechanic exists. This is the same gap CLAUDE.md's own
"closing the hard 20%" invariant describes elsewhere: the content is
authored to a high bar; the simulation that should be driven by it isn't
reading it yet.

## 7. Council/governance lens — depth if wired

Per independent read of `docs/lens-specs/council-capability-map.md`
(already-written, re-verified plausible against the domain file structure)
and confirmed by this audit's own read of `server/domains/council.js`: the
`council` lens is a **separate substrate** from Concordia world politics —
a Loomio+Convene-style collaborative governance workspace tool
(proposals/voting/meetings/committees/budget), player-authored, not tied
to authored factions or realms. Two items were flagged as real capability
sitting unsurfaced:

- `council.simulate-budget` (variance-weighted low/high/expected budget
  projection + risk score) — a genuine, non-trivial financial-modeling
  macro with zero frontend caller. **Would add real depth if wired** — a
  "Run Simulation" button is a scoped, additive build, not a fix.
- `council.audit`'s derived process-completeness/vote-timeline/debate-turn
  trail — real derived analytics sitting beside a shallower manually-logged
  audit list that's already honest (not fake, just a parallel weaker
  mechanism). Adding it as a secondary card would add depth but the
  existing tab is not dishonest.

Neither is faction/realm-political depth in the CK3/BG3 sense this audit
is scoped to — they're workspace-tool depth. Noted for completeness since
the assignment named `council.simulate-budget`/`council.audit` explicitly,
but they don't move the Concordia-politics verdict.

## 8. Kingdom decrees — real consequence, one authorization gap (fixed here)

`server/lib/kingdom-decrees.js` — 8 decree kinds
(`tax_change/conscription/trade_embargo/recipe_grant/pardon/exile/
construction/festival`), each with a real popularity delta that cascades
to every `realm_citizens` row via `character_opinions`
(`cascadeOpinionToCitizens`), and a real per-kind side effect
(`applyDecreeEffect`): `tax_change` writes `realms.tax_rate` (which feeds
`computeFactionStrength`, §3.1); `conscription` drains treasury -200 (and
is separately read by `computeFactionStrength` as a strength multiplier);
`exile` zeroes the target NPC's loyalty, records a −50 opinion event, and
**cascades into abandoning any scheme the exiled NPC was leading**
(`npc_schemes` phase → `'abandoned'`) — a real, multi-system consequence,
not a cosmetic flag flip. This is genuine CK3-adjacent "your decree has
teeth" design.

**Confirmed gap, independently re-verified from
`docs/lens-specs/kingdoms-capability-map.md`'s flag, then fixed in this
pass:** `revokeDecree` (`server/lib/kingdom-decrees.js`, pre-fix line
173-180) had no ruler-authorization check, unlike its sibling
`proposeDecree` (which checks `issuedByKind`/`issuedById` against the
realm's `ruler_kind`/`ruler_id`, lines 48-52). The macro
`kingdoms.revoke_decree` (`server/domains/kingdoms.js:138-143`) passes the
calling user's id straight through with no ownership check upstream —
meaning **any authenticated player who knew or enumerated a `decreeId`
could revoke any realm's active decree**, silencing another player's or
NPC ruler's governance with zero authority check.

**Fix applied** (`server/lib/kingdom-decrees.js`): `revokeDecree` now
looks up the decree's realm and rejects with `{ok:false,
reason:"not_authorised"}` unless the caller (`by`) is that realm's actual
`ruler_id` under `ruler_kind === "player"` — mirroring `proposeDecree`'s
existing pattern exactly. The `by === null/undefined` system/heartbeat
bypass (e.g. an inheritance reset) is preserved, matching
`proposeDecree`'s own `issuedByKind === "system"` bypass. This is a
narrow, non-money, non-JWT-auth read/write-permission check inside one
already-existing gameplay function — scoped small enough to fix directly
per this audit's brief. Pinned by a new test file,
`server/tests/kingdom-decrees-revoke-authz.test.js` (5/5 passing): rejects
a non-ruler caller, allows the real ruler, rejects any player against an
NPC-ruled realm, still allows `by=null` system calls, and returns
`decree_not_found` for an unknown id. Full pre-existing kingdoms test
suite re-run clean: `node --test tests/kingdoms-lens.test.js
tests/kingdom-seeder.test.js tests/realm-overview.test.js
tests/depth/kingdoms-behavior.test.js tests/viability/realm-control.test.js
tests/kingdoms-rule.test.js tests/kingdoms-domain-parity.test.js
tests/realm-access.test.js tests/kingdoms.test.js` → **134/134 pass, 0
fail** (unchanged from the capability-map's prior count; the new file adds
5 more, 139 total). `npx eslint server/lib/kingdom-decrees.js
server/tests/kingdom-decrees-revoke-authz.test.js` → clean.

**NPC-ruler decrees are also genuinely deterministic-not-random**
(`pickRulerDecree`, lines 187-222): low average citizen loyalty → festival
or (if the ruler's coping trait is `cruel`) exile; low treasury →
tax_change; high stress + paranoid → conscription; high stress + reckless
→ construction. This reads as a ruler with a legible personality driving
policy, not a dice roll.

## 9. Prioritized gap list

### ENGINEERING (code-only, no external data dependency)

1. **P0 — Wire `DECLARE_WAR`/`RAID` moves to `spawnFactionWar`.** The
   single highest-leverage fix for "player influences politics": when
   `faction-strategy-cycle.js` picks `DECLARE_WAR` or `RAID` (lines
   114-149), call `spawnFactionWar(db, {sideA, sideB, ...})` so the
   autonomous political decision actually produces a joinable combat event
   players can tip. Currently only reachable via an admin/test-only REST
   endpoint (§3.4) — the wiring on both ends is complete, only the
   connector between them is missing.
2. **P0 — Fix `getRelationScore`'s dead-code stub** (§4). Thread real
   per-pair `faction_relations` data from the cycle (which already holds
   `db`) into `pickMove`, replacing the hardcoded `return 0`. This single
   fix would make `PROPOSE_ALLIANCE` reachable from `consolidate` (currently
   dead) and make `DECLARE_WAR`'s target selection actually relation-gated
   as documented (currently a no-op). Deliberately not done in this pass —
   it changes a widely-tested function's signature/behavior and deserves
   its own scoped pass with updated tests, not a drive-by inside a
   read-only audit.
3. **P1 — Faction relation decay.** Add a lightweight heartbeat (or fold
   into the existing `faction-strategy-cycle`) that drifts `score` back
   toward 0 over time absent new events, so old wars/alliances don't stay
   maximally-extreme forever with no narrative "cooling off."
4. **P1 — A direct player lever on faction politics.** Even one macro —
   e.g. "lobby" (spend reputation/CC to nudge a friendly faction's momentum
   or bias its next `pickMove` roll) — would close the "sees but never
   steers" gap that's this audit's core finding. Realm rulership already
   proves the wiring pattern (governance decisions → `computeFactionStrength`
   → clash outcome); a lobby macro could reuse the same read path in
   reverse (player action → temporary strength/momentum nudge).
5. **P2 — Retire or wire the dead `tribute` relation kind** (§5) — either
   have a move type that sets it, or drop it from the CHECK constraint so
   the schema doesn't promise a mechanic that doesn't exist.

### CURATION (needs authoring, not new engineering)

6. **P2 — Hook authored faction `goal`/`values` into `pickMove` bias.**
   The content (§6) is rich enough to support this today — e.g. a faction
   whose `values` includes `"neutrality"` (Concordant Curators) could get a
   `DECLARE_WAR` probability discount, or one whose `goal` is explicitly
   territorial (Sanguire of Sandrun) could get an `PROCLAIM_EXPANSION`
   bump — turning 77 well-written-but-mechanically-inert faction sheets
   into faction-specific behavior instead of one shared state machine
   wearing 77 different names. This is the single highest-value use of
   existing authored material in this subsystem.
7. **P3 — Author internal-faction-split content as real branch points.**
   Several `faction_state.tensions` entries (Wildwood Circle's Thorne
   split, Sere's Tessera internal deniability, Sovereign Ruins' three
   Archivists disagreeing about whether to keep operating) already read as
   ready-made succession/schism plots — CK3's council-plot texture without
   the mechanic. Curate a subset into actual `npc_schemes` seeds (the
   scheme substrate already exists and is wired) rather than leaving them
   as unreachable prose.

### DATA-SOURCING

None identified. This subsystem is entirely internal simulation + authored
content — no external feed applies.

## Verification

- `node --test tests/kingdom-decrees-revoke-authz.test.js` → 5/5 pass (new).
- `node --test tests/kingdoms-lens.test.js tests/kingdom-seeder.test.js
  tests/realm-overview.test.js tests/depth/kingdoms-behavior.test.js
  tests/viability/realm-control.test.js tests/kingdoms-rule.test.js
  tests/kingdoms-domain-parity.test.js tests/realm-access.test.js
  tests/kingdoms.test.js` → 134/134 pass, 0 fail (pre-existing suite,
  re-verified unaffected by the `revokeDecree` fix).
- `npx eslint server/lib/kingdom-decrees.js
  server/tests/kingdom-decrees-revoke-authz.test.js` → clean, 0 errors.
- `grep -rn "faction:strategy-move\|faction:war-declared" concord-frontend/
  --include=*.tsx` → real consumers in `EmergentEventFeed.tsx`,
  `AdaptiveScoreBridge.tsx` (excluding build artifacts under `.next/`).
- `grep -rn "spawnFactionWar" server/ --include=*.js` → confirms the only
  non-definition, non-test caller is the admin-gated `/spawn` REST route.
- `grep -n "getRelationScore" server/lib/embodied/faction-strategy.js` →
  confirms the stub is the only definition and both call sites read it
  directly with no override path.
- Read all 9 `content/world/*/factions.json` files (77 factions total) in
  full for §6.
