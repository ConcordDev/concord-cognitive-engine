# Quest Engine Investigation — Wave 4 Gap Closure

> Status: **investigation complete, root cause empirically confirmed, NOT
> fixed here.** This is a diagnostic report per the Wave-4 triage rule
> (CLAUDE.md §6: closing the hard 20% invariant) — the fix requires an
> architectural decision between at least three plausible directions (see
> "Options for a future fix" below), touches 6+ files across two subsystems
> with different data models, and none of the options is a safe, narrow,
> single-PR correction. Filing this so a future session doesn't repeat the
> ~2-hour trace.

## TL;DR

Concord has **three independent, non-communicating quest storage systems**,
not two. Authored quest content (onboarding, main-arc, faction chains,
side quests, sub-world chains — 127 quests total per a live `seedContent()`
run) is loaded **only** into an in-memory `Map` (`server/emergent/quest-engine.js`)
that the live player-facing quest-offer path never reads from. Separately,
the SQL-backed engine the frontend actually uses (`server/lib/quests/quest-engine.js`,
`world_quests`/`player_quests`/`quest_objectives`/`quest_rewards`) is
populated **only** by a fourth, unrelated system — procedurally-LLM-generated
NPC-need quests (`server/lib/quest-emergence.js`). The two never overlap in
row identity, confirmed by direct DB inspection below. A third table,
`quest_progress` (singular), backs the onboarding "First Cycle" tutorial
derivation and has **zero production writers at all** — it is dead
infrastructure, exercised only by test fixtures and a synthetic health-check
probe that inserts rows itself.

**Net effect, empirically confirmed:** none of the 127 authored quests
(onboarding, main-arc, 8 faction chains, sub-world chains) can ever be
offered to, accepted by, or tracked for a real player through any live
in-game surface. This is true even for the onboarding "First Cycle"
(cook→eat→fight→commune) tutorial that CLAUDE.md's "Fully working
end-to-end" section had listed as shipped — it is not, for a different
but related reason (see Finding 4).

## Method

1. Read both files claimed to be "the quest engine" in full:
   `server/emergent/quest-engine.js` (829 LOC, in-memory `Map`-backed,
   `createQuest`/`startQuest`/`completeStep`/breadcrumb protocol) and
   `server/lib/quests/quest-engine.js` (264 LOC, SQL-backed against
   migration 068's `player_quests`/`quest_objectives`/`player_quest_progress`/
   `quest_rewards` tables).
2. Grepped every caller of both files' exports across `server/`.
3. Read all of `content/quests/*.json` (onboarding, main-arc, faction-quests,
   5 hand-authored side quests, `sub-worlds/**`) and the seeding code path.
4. Traced the dialogue-offer path (`routes/worlds.js`), the quest-accept
   path (`server.js`, `routes/worlds.js`), the `/lenses/quests` macro surface
   (`server/domains/quests.js`), and the onboarding tutorial deriver
   (`server/lib/tutorial-first-cycle.js`) line by line.
5. **Empirically confirmed** (not inferred) by booting a real migrated
   in-memory DB, calling the real `seedContent()`, and inspecting both the
   in-memory registry and the SQL tables directly — reproduction below.

## The three systems

### System A — in-memory "structured learning path" engine
`server/emergent/quest-engine.js` (829 LOC). Doc header: *"System 6: Quest
Engine — Structured Learning Paths with Breadcrumb Protocol… Additive only.
Silent failure. All state in-memory."* Keyed by a generated
`quest_<20-hex-chars>` id (`uid("quest")` at `server/emergent/quest-engine.js:39-41`,
called from `createQuest` at `:154`). State lives in a module-level `LruMap`
(`:117`) and `Map` (`:118`) — **never persisted**, reset on every process
restart. Exports `createQuest`, `getQuest`, `listQuests`, `startQuest`,
`completeStep`, `releaseInsight`, `getActiveQuests`, `getQuestProgress`
(1-arg signature — `getQuestProgress(questId)`, `:521`), `createFromTemplate`,
`getQuestMetrics`.

**Who calls it:**
- `server/lib/content-seeder.js:17` imports `createQuest` and calls it once
  per authored quest file at boot, inside `seedQuestFile()`
  (`server/lib/content-seeder.js:499-552`). This is the **only** production
  writer into System A.
- `server/lib/lattice-quest-composer.js:384-397` also calls
  `qe.createQuest(...)` (lazy-imported) to spin up drift-alert-born quests —
  a second, independent source of System-A rows, unrelated to authored
  content.
- `server/server.js:54021-54022` (`POST /api/quests/accept`) calls
  `qe.startQuest(questId, userId)` — the only production **read/mutate**
  caller besides the seeder.
- `server/lib/narrative-bridge.js:476-498` (`buildQuestContext`) calls a
  content-seeder helper (`getQuestsForNPC`, System A's authored registry —
  see below), feeding `generateAuthoredDialogue` (`:511`) and
  `generateArcQuestChain` (`:598`).

### System B — SQL state-machine engine
`server/lib/quests/quest-engine.js` (264 LOC). Pure functions over four
tables from migration 068 (`server/migrations/068_quest_state_machine.js`):
`player_quests` (id, user_id, quest_id, world_id, status, completed_at,
rewarded_at), `quest_objectives` (quest_id, type, target, required_count,
order_index), `player_quest_progress` (per-objective counters), and
`quest_rewards` (quest_id, reward_type, reward_key, amount). Exports
`getActiveQuests(db,userId,worldId)`, `getCompletedQuests(...)`,
`getQuestProgress(db,userId,worldId,questId)` (4-arg — a **different
signature** from System A's same-named export), `recordObjectiveProgress`,
`checkQuestCompletion`, `claimQuestRewards`, `addQuestObjectives`,
`addQuestRewards`. Crucially, **System B has no `createQuest` of its own —
it only ever reads/mutates rows that already exist in `world_quests`.**

**Who calls it:**
- `server/domains/quests.js:99-236` — all 9 `quests.*` macros surfacing
  `/lenses/quests` are thin delegations into System B (confirmed via its own
  header comment, `server/domains/quests.js:1-11`).
- `server/routes/worlds.js:347-360` (`GET /:worldId/quests/active`) and the
  claim-reward route both call System B directly — this is what
  `QuestTracker.tsx` (the in-world HUD) reads.
- `server/server.js:33136-33140`, `:33171-33174` (cook/consume gameplay
  hooks) call `recordObjectiveProgress` — **but only if a matching
  `quest_objectives` row exists** (see Finding 3).

**Who creates `world_quests` rows (the thing System B reads):**
- **Only** `server/lib/quest-emergence.js:84-97`
  (`createQuestFromNeed`) — a procedural, LLM-generated quest spawned when
  an NPC's `purpose`/`social` need drops below 0.5
  (`server/lib/quest-emergence.js:8,22-24`). This is a completely different
  origin than authored `content/quests/*.json`. Its objectives are stored
  inline as `objectives_json` on the `world_quests` row itself
  (`:86-95`) — **not** as rows in the `quest_objectives` table System B's
  `getActiveQuests`/`getQuestProgress` actually query (see Finding 3).

### System C — dead onboarding-tracker table
`quest_progress` (singular; migration `server/migrations/315_missing_tables_repair.js:69`).
Read exclusively by `server/lib/tutorial-first-cycle.js:71-75`
(`deriveFirstCycleProgress`), which backs `GET /api/tutorial/first-cycle`
(`server/server.js:49532-49546`) — the endpoint the `FirstWinWizard`
onboarding UI polls. **Zero production code writes to this table** — grep
confirms the only `INSERT INTO quest_progress` statements in the whole
`server/` tree are in test fixtures
(`server/tests/e2e/first-cycle-journey.test.js:52-63`,
`server/tests/e2e/first-day-arc.test.js:65-73`,
`server/tests/embodied-forward-sim.test.js:66`,
`server/tests/e2e/handshake-revelation-arc.test.js:73`) and
`server/lib/synthetic-journey-probe.js:56-61`, which builds its **own**
in-memory `:memory:` DB and inserts synthetic rows purely to smoke-test the
derivation function — it never touches the real production DB.

## Empirical confirmation

Ran the exact minimal-migrated-DB pattern `server/tests/integration/sub-world-parity.test.js`
already established (migration 128 + 068 + the handful of tables
`content-seeder` needs), then called the real `seedContent({db})` and
inspected both stores directly (script executed via `node`, output captured
verbatim, then discarded — not committed):

```
=== seedContent result ===
{ "counts": { "quests": 127, ... } }

=== _authoredQuests (System A's authored registry) ===
size: 127
  first_cycle_cook present: true
  first_cycle_eat present: true
  cracks_in_the_compact present: true     ← main-arc quest 1 of 7

=== world_quests SQL table (what the live quest-offer / QuestTracker / quests-lens path reads) ===
total rows: 0
  first_cycle_cook present in world_quests: false
  first_cycle_eat present in world_quests: false
  cracks_in_the_compact present in world_quests: false

=== quest_progress table ===
quest_progress table does not exist in this minimal migrated DB   (confirms: no seeder path creates or needs it either)

=== quest_objectives (what recordObjectiveProgress / getActiveQuests actually join against) ===
quest_objectives rows: 0
```

127 authored quests loaded into System A's registry; **zero** rows in the
SQL table the frontend actually queries. This is not a partial/edge-case
gap — it is total: not one authored quest of any kind (onboarding, main
arc, faction, side, sub-world) is reachable through `world_quests`.

## Findings, with the exact break point for each

### Finding 1 — the dialogue quest-offer path only ever queries System B, which authored content never reaches
`server/routes/worlds.js:1129-1131` and `:1421-1424` (both copies of the
`questOffered` builder, in `POST /:worldId/npcs/:npcId/dialogue` and
`.../dialogue/respond`):
```js
quests = db.prepare(
  "SELECT * FROM world_quests WHERE giver_npc_id = ? AND status = 'available' LIMIT 3"
).all(npcId);
```
This is the **only** production code that decides what quest a player is
offered mid-conversation. It reads `world_quests` exclusively. Per the
empirical run above, authored content is never in that table — so an NPC
whose backstory in `content/quests/main-arc.json` or `content/quests/faction-quests.json`
names them as `giver_npc_id` will never actually offer that quest; only a
quest-emergence.js-spawned procedural quest can appear here.

### Finding 2 — the "canonical" accept path can never succeed for a real offer, and the comment is itself evidence of the confusion
`concord-frontend/components/world/NPCDialogue.tsx:616-626`:
```tsx
// Try the canonical /api/quests/accept first; fall back to the legacy
// world-scoped endpoint if it isn't available.
let r = await fetch('/api/quests/accept', { ... body: JSON.stringify({ questId: questOffered.id }) });
if (!r || !r.ok) {
  r = await fetch(`/api/worlds/${worldId}/quests/${questOffered.id}/accept`, { method: 'POST' });
}
```
`/api/quests/accept` (`server/server.js:54016-54032`) calls System A's
`qe.startQuest(questId, userId)`. But `questOffered.id` (per Finding 1)
**always** originates from a `world_quests.id` — a `crypto.randomUUID()`
minted by `quest-emergence.js:84`. System A's `quests` Map is keyed by its
own `uid("quest")` format (`quest_<hex>`). The two id spaces never
intersect, so `/api/quests/accept` returns `{ok:false, error:"quest_not_found"}`
(`server/emergent/quest-engine.js:223`) for literally every real offer, on
every call, by construction — not intermittently. The frontend's own code
comment calling this path "canonical" is itself a symptom: the codebase's
own authors believed System A was the source of truth for a offered quest
id that in every real case actually came from System B. The silent
`.catch(() => null)` + unconditional fallback (`:623-625`) masks this
100%-failure-rate call as if it were a normal cache-miss, which is why it
was never noticed.

### Finding 3 — even the reachable half (System B) is missing its own objectives/rewards in production
Not part of the original gap description, but discovered while tracing:
`server/domains/quests.js:215-243` exposes `quests.addObjectives` /
`quests.addRewards` — the **only** functions capable of inserting rows into
`quest_objectives` / `quest_rewards` (delegating to
`server/lib/quests/quest-engine.js:228-264`). Grepping every caller of
`addQuestObjectives`/`addQuestRewards` across `server/` turns up **zero
production callers** — only `server/tests/quests-domain-macros.test.js:116-123`
and `server/tests/milestone-unlocks.test.js:43,64` call them directly.
`server/lib/lattice-quest-composer.js` (cited in the pre-existing
`docs/lens-specs/quests-capability-map.md` as a caller of
`addObjectives`/`addRewards`) in fact calls **System A's** `qe.createQuest`
(`server/lib/lattice-quest-composer.js:384-397`), not System B's helpers —
that capability-map claim is stale/incorrect (corrected below). Net: even
the one class of quest that genuinely reaches `world_quests`
(`quest-emergence.js`'s procedural NPC-need quests) has **zero**
`quest_objectives` rows and **zero** `quest_rewards` rows attached, because
its objectives live inline as `objectives_json` on the `world_quests` row
itself (`server/lib/quest-emergence.js:86-95`) — a shape `getActiveQuests`/
`getQuestProgress`/`claimQuestRewards` never read (they join the separate
tables). So `/lenses/quests`' Active tab and the world-lens `QuestTracker`
will show a title/description for a procedural quest but an **always-empty
objectives list**, and claiming its reward will **always grant nothing**
(`claimQuestRewards`'s `rewards` array comes from `quest_rewards`, which is
never populated for these rows either — `server/lib/quests/quest-engine.js:182-184`).

### Finding 4 — the onboarding "First Cycle" tutorial is also structurally dead, for a third, unrelated reason
`server/lib/tutorial-first-cycle.js:57-77` (`deriveFirstCycleProgress`)
is supposed to read live progress via `questEngine.getQuestProgress` when
given one, falling back to a raw `quest_progress` table read otherwise.
`server/server.js:49537-49539` passes `questEngine = await import("./emergent/quest-engine.js")`
— **System A**, whose `getQuestProgress` takes 1 argument
(`server/emergent/quest-engine.js:521`, `getQuestProgress(questId)`). The
helper's own guard (`server/lib/tutorial-first-cycle.js:65`,
`questEngine.getQuestProgress.length >= 4`) correctly detects the signature
mismatch and **always** falls through to the `else if (db)` branch — a
direct `SELECT ... FROM quest_progress` (System C). Per Finding on System
C above, nothing in production ever writes to `quest_progress`. So
`GET /api/tutorial/first-cycle` reports `currentPhase: "cook"`,
`complete: false` for every player forever, regardless of what they
actually do — even though the real gameplay hooks
(`server/server.js:33135-33141` cook, `:33170-33175` consume, plus the
documented `reach-location`/combat/dialogue hooks) are wired to call
System B's `recordObjectiveProgress` correctly. Those calls are harmless
no-ops today per Finding 3 (no matching `quest_objectives` rows exist for
`first_cycle_recipe` etc., because content-seeder never bridges authored
quests into System B at all) — so the tutorial's underlying objective
tracking is *also* silently inert, independent of the dead `quest_progress`
read. Two independent breaks stack on the same feature.

## What already works (so a fix doesn't need to touch these)
- **Procedural NPC-need quests** (`quest-emergence.js`) do reach
  `world_quests`, can be offered via dialogue, and can be accepted via the
  SQL accept route (`server/routes/worlds.js:312-333`) — title/description/
  accept/status-transition all function. Only their objectives/rewards
  payload is inert (Finding 3).
- **Lattice-born quests** (drift-alert-triggered) go through System A via
  `lattice-quest-composer.js` and have their own dedicated
  `lattice_born_quests` table (migration 132) plus their own realisation
  hook (`server/emergent/quest-engine.js:419-430`) — a fourth, self-
  contained path not audited further here since it isn't part of the
  authored-content gap and isn't reported broken elsewhere.
- **Reward-grant plumbing on System A** (`server/lib/quest-rewards.js`,
  wired at `server/emergent/quest-engine.js:432-444`) is real and would
  fire correctly **if** a System-A quest were ever started by a real
  player — which per Finding 2 never happens for authored content.
- The `/lenses/quests` frontend itself (`quests.mine`/`quests.completed`/
  `quests.claimRewards`) is honestly built against System B and does
  exactly what System B's real (if starved) data supports — this was
  already verified by the prior capability-map pass and nothing here
  contradicts it. The lens is not the defect; its upstream data supply is.

## Options for a future fix (not attempted here — needs an owner decision)

None of these is a small, safe, single-PR change; each is a real design
choice with different tradeoffs:

1. **Bridge authored content into System B at seed time.** Extend
   `content-seeder.js#seedQuestFile` to also `INSERT INTO world_quests`
   (status `'available'`) + call `addQuestObjectives`/`addQuestRewards` for
   each authored quest, using the authored JSON `id` as `world_quests.id`
   (so `getQuestsForNPC`/`moral-branch.js`'s existing keying by authored id
   keeps working). Retarget the dialogue-offer queries
   (`routes/worlds.js:1129`, `:1421`) to no longer need changing (they
   already read `world_quests`). **Loses**: System A's breadcrumb protocol
   (`buildBreadcrumbs`, progressive insight release — `server/emergent/quest-engine.js:352-368`,
   `:695-725`) has no SQL-schema analog today; a straight bridge either
   drops breadcrumbs for authored quests or requires a new migration
   (`quest_breadcrumbs` table + release-schedule logic ported from System
   A). Also needs reconciling System A's free-form `rewards: {}` object
   shape against System B's typed `quest_rewards` rows (System A already
   forwards `moral_branch` — that part ports cleanly, per
   `server/lib/content-seeder.js:526-533`, since `moral-branch.js` already
   reads `_authoredQuests` directly rather than through System A's runtime
   object).
2. **Keep both engines; add an explicit id-mapping + dual-read at the offer
   site.** Have the dialogue-offer query check `_authoredQuests`
   (via `getQuestsForNPC`, already exported and correct —
   `server/lib/content-seeder.js:1280-1286`) in addition to `world_quests`,
   and have `/api/quests/accept` succeed against a synthetic `world_quests`
   row created on first accept (lazily materializing System A quests into
   System B only when a player actually takes one). Avoids a schema change
   for breadcrumbs (they stay served from System A for authored quests) but
   means `/lenses/quests` and `QuestTracker` need two read paths merged,
   and `quests.mine`/`getActiveQuests` (SQL-only today) would need to learn
   about System-A-originated quests too.
3. **Retire System A for authored content entirely; author quests directly
   as System-B-shaped JSON going forward** (objectives/rewards arrays
   instead of steps/breadcrumbs), and treat System A as what it already
   functions as today — the lattice-born-quest generator's private
   scratch engine, nothing else. Simplest end-state, but is a genuine
   content-authoring-format migration across `content/quests/*.json`
   (main-arc, 8 faction chains, onboarding, 5 side quests, and every
   sub-world chain file) plus a rewrite of `moral-branch.js`'s and
   `narrative-bridge.js`'s `_authoredQuests` reads.
4. **Independent of 1-3: fix Finding 3 and Finding 4 regardless**, since
   they're break points inside whichever direction is chosen — wire
   `quest-emergence.js:84-97` to also call `addQuestObjectives`/
   `addQuestRewards` (or store real rows instead of `objectives_json`), and
   either wire a real `quest_progress` writer or retarget
   `tutorial-first-cycle.js` to read System B (once authored quests reach
   it via option 1 or 2) and delete the dead `quest_progress` table +
   `synthetic-journey-probe.js`'s self-contained fixture that currently
   masks the break instead of catching it.

Recommendation for the eventual owner: **option 1 with the breadcrumbs gap
named explicitly** is the most architecturally honest (one canonical
persisted store, matches how the rest of Concord treats "gameplay state
must survive a restart"), but it's real migration + porting work across a
content-authoring format that's been stable a long time, so it deserves its
own scoped unit rather than folding into a lens-rebuild pass.

## Corrections made to other docs as a result of this investigation

- `docs/WAVE4_INVENTORY.md` — the `quests` row's summary changed from
  "may never reach players" (hedged) to a confirmed, empirically-verified
  statement, and now points at this doc instead of "recommends a follow-up
  investigation" (the follow-up happened; this is its output).
- `docs/lens-specs/quests-capability-map.md` — its own "Adjacent
  observation" section (written during the prior verify-pass) already found
  the System-A/System-B split correctly but understated it as "most likely
  never reach players" and got one detail wrong (attributing
  `addObjectives`/`addRewards` calls to `lattice-quest-composer.js`, which
  actually calls System A's `createQuest`). Updated to point here with the
  confirmed finding and the correction.

## Addendum (2026-07-12) — moral_branch frontend-attach-point check

A later Wave 4 unit (closing `docs/concordia-specs/quests-dialogue-capability-map.md`
§3's still-open frontend half) independently re-ran this doc's empirical
check with the full real migration set and confirmed it holds exactly:
127 authored quests in System A, zero rows in `world_quests`. It also
extended the trace one level further, specifically for the 14
`moral_branch`-bearing quests, and found a detail this doc didn't need at
the time: **exactly 2 of those 14 quests' giver NPCs
(`lady_seraphine_voss`, `broker_silver_vey`) have an authored dialogue
tree** (the one mechanism that bypasses the System A/B split entirely —
see Finding 1's context). Both trees turned out to be a single generic
`<npcId>:idle` entry with no quest-specific node, so this doesn't open a
safe attach point — presenting a climactic reputation-altering choice on a
generic idle greeting, with no preceding quest content ever having been
offered or tracked, would misrepresent the player's story progress. Noting
it here so a future session pursuing Option 1 (bridge authored content
into `world_quests`) knows these 2 NPCs already have *some* authored
dialogue infrastructure to build on, even though it isn't quest-specific
yet. Full trace: `docs/concordia-specs/quests-dialogue-capability-map.md` §3.
