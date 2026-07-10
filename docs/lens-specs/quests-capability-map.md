# Quests Lens — Capability Map (Verify-Pass + Small Fix)

> Derived, not asserted. A prior audit had flagged `quests` as an incomplete
> "retry backlog" item (`docs/FRONTEND_REBUILD_PROGRAM.md`) — that flag was
> about the *rebuild session* running out of token budget before attempting
> the lens, not about the lens's actual quality. This pass re-verified from
> scratch: `app/lenses/quests/page.tsx` (now 269 LOC, was 213) is a real, bespoke,
> honestly-wired page — the prior spot-audit's "25% macro reference"
> statistic undercounted because the domain itself only exposed a fraction
> of what the underlying engine can do. This pass found and fixed one real,
> concrete gap (the Completed tab was structurally dead) and one fully
> unsurfaced macro (`quests.claimRewards`), both now wired.
>
> Backend surface enumerated by reading `server/domains/quests.js` (macro
> registrations), `server/lib/quests/quest-engine.js` (the real engine the
> macros delegate to), `server/domains/hidden-quests.js` +
> `server/lib/quest-triggers.js` (an adjacent, correctly-not-this-lens
> system), `server/emergent/quest-engine.js` + `server/lib/content-seeder.js`
> (the separate authored-quest-chain engine — see "Adjacent observation"),
> and grepping `server.js`/`routes/worlds.js` for quest-shaped routes.
> Reproduce the domain macro list:
> `grep -n 'register("quests"' server/domains/quests.js`

## Backend surface

### Registered macros — `server/domains/quests.js` (9, was 8 before this pass)

| Macro | Real result shape (key fields) | Classification |
|---|---|---|
| `active` | `{ok, quests:[{...world_quests row, objectives:[quest_objectives rows], rewards:[quest_rewards rows]}]}` — raw engine shape, objectives carry NO per-player progress | GENERIC — an internal/API-parity shape, not lens-shaped; superseded for UI purposes by `mine` |
| `mine` | `{ok, quests:[{id,title,description,status,objectives:[{id,title,progress,target,complete}],reward:{cc?,title?}}]}` — lens-shaped, real merged objective progress via `getQuestProgress` join | **DESIGNED** — Active tab (default) |
| `completed` *(NEW this pass)* | Same lens shape as `mine`, but sourced from `getCompletedQuests` (status IN `completed`/`rewarded`) | **DESIGNED** *(added + wired this pass)* — Completed tab |
| `progress` | `{ok, objectives:[{...quest_objectives row, current_count, obj_completed_at}]}` for one quest | UNSURFACED — the lens only needs the merged-into-`mine`/`completed` shape; a single-quest detail drill-down isn't part of this lens's scope (no quest-detail view exists) |
| `recordProgress` | `{ok}` — monotonic, capped, auto-completes | UNSURFACED by design — objective progress is a SERVER-side side effect of gameplay actions (combat kills, dialogue talk_to, gathering), not a player-invoked UI action. Correctly never called from the lens. |
| `checkCompletion` | `{ok, completed}` | UNSURFACED — `recordProgress` already auto-calls this internally on every progress write; no standalone UI need |
| `claimRewards` | `{ok, rewards:[{type,...}]}` or `{ok:false, error}`, idempotent (`player_quests.rewarded_at` gate) | **DESIGNED** *(wired this pass)* — "Claim" button on completed-but-unrewarded quests |
| `addObjectives` | `{ok, count}` | WORLD-OWNED / authoring-only — called by the quest builder + lattice-born quest composer (`lattice-quest-composer.js`), never by a player-facing lens |
| `addRewards` | `{ok, count}` | WORLD-OWNED / authoring-only — same as above |

### Adjacent, correctly-separate REST surface (not this lens's macros, still real)

- `POST /api/parties/:partyId/share-quest` — the page's "Share" button on
  active quests, only shown when `GET /api/parties/me` reports the caller is
  in a party. **DESIGNED**, verified real (not a macro, a direct route call
  — legitimate wiring choice, same pattern the `lfg` capability map
  documents as acceptable).
- `GET /api/worlds/:worldId/quests/active` (`routes/worlds.js:347`) — the
  SAME `getActiveQuests` function `quests.mine` wraps, consumed by the
  in-world `QuestTracker.tsx` HUD. Confirms `quests.mine`/`quests.completed`
  read the CANONICAL, live quest table (`world_quests`/`player_quests`,
  migration 068) — not a shadow/secondary system.
- `POST /api/worlds/:worldId/quests/:questId/claim-reward` — QuestTracker's
  own claim action, same underlying `claimQuestRewards` engine fn the new
  `quests.claimRewards` macro now also exposes standalone in this lens.

## What was fixed this pass

**1. The Completed tab was structurally, permanently dead.**
`server/lib/quests/quest-engine.js#getActiveQuests` — the only function
`quests.mine` ever called — filters `WHERE pq.status IS NULL OR pq.status =
'active'`. It is *impossible* for that query to ever return a
`completed`/`rewarded` row. The page's Completed tab client-filtered
`quests.mine`'s result for `status === 'completed' || status === 'rewarded'`
— a filter over a result set that structurally never contains those values.
A player who finished and even claimed a dozen quests would see "No
completed quests yet" forever, with no error and no honest signal that the
tab was non-functional (a soft honesty violation — the empty state implied
"you haven't completed one," not "this isn't wired").

Fix: added `getCompletedQuests(db, userId, worldId)` to
`server/lib/quests/quest-engine.js` (mirrors `getActiveQuests`, complementary
status filter, `ORDER BY completed_at DESC LIMIT 50`), registered it as the
new `quests.completed` macro, and extracted the row→lens-shape reshape logic
(previously duplicated inline in the `mine` handler) into a shared
`reshapeQuestForLens(db, userId, worldId, q)` function so `mine` and
`completed` can never drift into different shapes for the same kind of row.
The page now fetches both macros in parallel on load/refresh (the
`completed` call is best-effort, matching the existing party-lookup
pattern — a hiccup there degrades to "no history shown," it never blocks the
primary active list) and merges by id.

**2. `quests.claimRewards` was fully unsurfaced.**
The macro existed and worked (pinned by the pre-existing lifecycle test),
but nothing in the frontend ever called it — a quest could auto-complete
(`checkQuestCompletion` fires inside `recordProgress`) and then sit
`completed`-but-unrewarded forever unless the player happened to be
standing in the world lens and used `QuestTracker.tsx`'s claim button. Added
a "Claim" button (Gift icon) on each Completed-tab quest with
`status === 'completed'`, wired to `quests.claimRewards`; a
`status === 'rewarded'` quest instead shows a "Claimed" badge. Real
optimistic local-state flip to `'rewarded'` on success (honest — a failure
shows the real server error via the existing flash-message mechanism, no
fabricated success).

Both changes are covered by new tests: `server/tests/quests-domain-macros.test.js`
(+4 assertions: registration, the `completed`/`mine` partition-no-overlap
lifecycle round-trip, the no-db/no-user guard rails) and
`concord-frontend/tests/lenses/quests-page.test.tsx` (+4 tests: the
`completed` macro is called alongside `mine`; Completed-tab data is real,
not filtered from `mine`'s always-active set; the Claim button calls
`quests.claimRewards` and flips to a Claimed badge; a `rewarded` quest shows
the badge with no button).

## Dead-panel check

No other dead panel found. The Active tab was always real (pinned by the
pre-existing test suite). The Available tab is intentionally NOT a listing —
see below — and its empty-state copy ("Available offers show up here when
an NPC has work for you") is honest about that: it does not claim this tab
lists anything, it correctly describes the real interaction model (an NPC
dialogue popup, not a catalog).

## Fake-data check

Ran the real detector (`server/lib/detectors/frontend-fake-data-detector.js`
`runFrontendFakeDataDetector`) against the full frontend tree: **0 findings**
under `app/lenses/quests/`. No `components/quests/` directory exists — the
lens is self-contained in one page file, same pattern as `lfg`. Manually
re-confirmed all three rules by hand post-fix: no hardcoded content arrays
(`Tab`/`LoadState` are string-literal union types, not object-array data),
no `Math.random()`, no lorem/placeholder/dummy/fake/mock/TODO strings in any
rendered literal.

## Macro coverage sanity check

The `quests` domain is deliberately small (9 macros) relative to the deep
quest SUBSTRATE CLAUDE.md documents (`server/emergent/quest-engine.js`,
`server/lib/oracle-brain.js`, `content/quests/*`, `lattice_born_quests`,
`player_beats`) — see "Adjacent observation" below for why that's correct,
not a gap. Of the 9: 3 are player-facing read/claim actions now all
DESIGNED (`mine`, `completed`, `claimRewards`); 2 are authoring-only and
correctly WORLD-OWNED (`addObjectives`/`addRewards`, called by content
seeding + the lattice quest composer, never by a player); 3 are correctly
UNSURFACED because they're either superseded (`active` by `mine`) or
internal-only side-effect plumbing that fires from gameplay events, not UI
buttons (`recordProgress`, `checkCompletion`). That's a coherent, complete
surface for a "read my quest log + claim rewards" lens — there is no
remaining real gap inside the `quests` domain itself.

## Adjacent observation (out of scope, not fixed here — flagging for the record)

While tracing where `questOffered` (the NPC-dialogue quest-accept popup)
gets its data, this pass found a genuine architectural bifurcation that is
**not a defect in this lens** but is worth recording:

- `content-seeder.js#seedQuestFile` seeds the onboarding chain, 7-quest main
  arc, 8 faction quests, and several hand-authored side quests
  (`content/quests/*.json`) into `server/emergent/quest-engine.js`'s
  **in-memory** `Map`-backed engine (`createQuest`/`startQuest`/
  `completeStep`), reachable via the top-level `POST /api/quests/accept`
  route.
- The `/lenses/quests` page (and the world lens's `QuestTracker.tsx`, and
  the NPC dialogue "I heard you need help..." offer) all read/write the
  **separate**, SQL-backed `world_quests`/`player_quests` tables (migration
  068) via `server/lib/quests/quest-engine.js` — confirmed by reading
  `routes/worlds.js`'s dialogue-respond handler: `questOffered` is built
  exclusively from `db.prepare("SELECT * FROM world_quests WHERE
  giver_npc_id = ? AND status = 'available'")`, never from the emergent
  engine's `_authoredQuests`/`getQuestsForNPC` (which exists as an exported
  helper but has zero callers in `routes/worlds.js`).
- Net effect: the authored narrative quest chains most likely never reach a
  live player through the dialogue-offer path, because the two engines
  don't share row identity and nothing bridges them. `NPCDialogue.tsx`'s
  accept handler *does* try `/api/quests/accept` (the emergent-engine route)
  first, falling back to the world-scoped SQL route — but the `questId` it
  has in hand only ever came from a `world_quests` row, so the emergent-side
  attempt would only succeed by id coincidence.

This is a real, sizeable finding — but it's a **backend quest-engine
bridging question that affects the whole game equally** (the world lens's
own QuestTracker has the identical blind spot), not something a
`/lenses/quests` rebuild could fix: there is no macro or route today that
lists "authored emergent quests available to me," so there is nothing this
lens could wire around it without new backend work. Recommend a follow-up
backend investigation/unit (outside this verify-pass's scope) to confirm
whether the main-arc/faction quest content is actually reachable in live
play, and if not, either bridge `createQuest`'s authored content into
`world_quests` at seed time, or retarget the dialogue offer path to also
check `getQuestsForNPC`.

`server/domains/hidden-quests.js` (the `hiddenQuests.*` macros, backed by
`server/lib/quest-triggers.js`) is a separate, correctly-not-this-lens
system: proximity/visit/dialogue/item/time/world-state triggers that START a
quest when fired — an authoring + runtime-trigger substrate consumed by
world-lens gameplay code, not a player-facing browsing surface. No gap here.

`questmarket` (bounty/task marketplace, `server/domains/questmarket.js` if
present, `/lenses/questmarket`) is a **different lens entirely** — CC-bounty
task board, unrelated to the RPG quest log despite the name collision in
`lens-features.js`. Confirmed via file inspection; not in scope.

## Verification run

- `cd server && node --test tests/quests-domain-macros.test.js` → 12/12
  passing (was 10/10 before this pass; +2 new tests for `quests.completed`).
- `cd concord-frontend && npx vitest run tests/lenses/quests-page.test.tsx`
  → 10/10 passing (was 6/6 before this pass; +4 new tests for the Completed
  tab + Claim button).
- `cd concord-frontend && npx eslint app/lenses/quests/page.tsx
  tests/lenses/quests-page.test.tsx` → clean.
- `cd concord-frontend && npx tsc --noEmit -p .` → clean, 0 errors
  project-wide.
- `cd server && npx eslint domains/quests.js lib/quests/quest-engine.js
  tests/quests-domain-macros.test.js` → clean.
- `node --check` on both touched backend files → syntax OK.
- Frontend fake-data detector re-run post-fix → 0 findings under
  `app/lenses/quests/`.

## Disposition: **small-fix, applied**

The prior "retry backlog" filing was accurate about *why* the lens wasn't
attempted (session token limit) but the lens was already close to real —
one honest-empty-state tab was quietly dead and one macro was unsurfaced,
both now real. No further rebuild needed. Recommend removing `quests` from
any remaining Wave-1-retry backlog language in
`docs/FRONTEND_REBUILD_PROGRAM.md`, and opening a small separate backend
unit for the emergent-vs-SQL quest-engine bridging question above.
