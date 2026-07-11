# Sub-Worlds Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## What this lens actually is

`/lenses/sub-worlds` is a **Roblox / Rec Room-parity creator-platform layer**:
spawn a hostable "sub-world," set its privacy/kind/capacity, discover other
players' public worlds, favorite them, co-edit with invited editors, author
it block-by-block in an in-place editor, watch a 14-day visit-analytics
timeline, and — the entire point of the product category — **actually enter
it**. Reference bar: Roblox's "create → discover → play" loop, not a generic
CMS. This is a distinct concept from CLAUDE.md's "9 authored sub-worlds"
(`content/world/{tunya,crime,cyber,...}` seeded by `content-seeder.js
#discoverSubWorlds()`) — those are hand-authored lore zones; this lens is the
**user-generated-content layer sitting on top of the same 3D Concordia
engine**. The domain file's own header comment already flags this naming
collision; it is not a bug, just something to read carefully.

## Backend surface

```
grep -c 'registerLensAction("sub_worlds"' server/domains/sub-worlds.js
```
→ **15** macros in `server/domains/sub-worlds.js` (~525 lines after this
pass), registered via `registerSubWorldsActions(registerLensAction)`. Domain
string is `sub_worlds` (underscore) — distinct from the legacy singular
`sub_world` domain still registered inline in `server.js` (`spawn_from_forge`,
`list`), which writes to a completely separate `sub_worlds` SQL table and
predates this lens. The two `sub_world(s)` domains do not share storage; the
frontend only ever calls the plural `sub_worlds` domain.

Storage model: **per-user in-memory STATE** (`globalThis._concordSTATE
.subWorldsLens`, matching the answers/message/whiteboard domains) is the
*canonical* record for the creator-platform layer — settings, analytics,
editor blocks, favorites. Handlers never throw (`{ ok, result? | error? }`
everywhere) and are dual-bus registered (LENS_ACTIONS + a MACROS mirror), so
they're reachable from `/api/lens/run`, `runMacro`, and the MCP host alike.

Macro groups: `spawn`, `list`, `discover` (query/kind/sort-filtered public
gallery), `update_settings`, `set_status` (active/paused), `archive`
(soft-archive or `hardDelete`), `visit` (visitor-count + travel hand-off),
`favorite`, `my_favorites`, `analytics` (14-day visit timeline + popularity
breakdown), `invite_editor`/`remove_editor`, `editor_state`/
`editor_add_block`/`editor_remove_block` (the in-place world editor).

## Frontend surface

`concord-frontend/app/lenses/sub-worlds/page.tsx` (now 410 lines) +
`concord-frontend/components/sub-worlds/{WorldCard, WorldSettingsPanel,
WorldEditorPanel, WorldAnalyticsPanel, MetaverseRepos}.tsx`. All 15 macros
already had a real, bespoke caller before this pass (Discover/Mine/Favorites
tabs, a real spawn form, per-owner Settings/Analytics modals, a co-editor
management UI, and a full block-placement editor with a live block/log feed)
— **no UNSURFACED macro, no generic-scaffold signature** (no
`ManifestActionBar`/`AutoActionStrip`-as-primary-surface,  no
`<UniversalActions>`/`<LensFeaturePanel>` body, no raw JSON-paste form). Every
field name in every `lensRun` call was re-verified against the real handler
source in `domains/sub-worlds.js` and all matched (`worldId`, `name`,
`description`, `thumbnail`, `privacy`, `kind`, `capacity`, `editorUserId`,
`blockId`, `type`/`label`/`x`/`y`/`z` — no mismatches found).

`MetaverseRepos.tsx` is a nice, honest bonus panel: a live, unauthenticated
client-side `fetch` to `api.github.com/search/repositories?topic=…` (metaverse
/ vrchat / webxr / three-js / mmorpg), giving the lens a real "what does the
category leader's ecosystem look like" cross-reference — every repo rendered
is real, with a working link, sourced live, not fabricated. Same idiom used
by several other rebuilt lenses in this program for "real-world pulse"
panels (e.g. `law-enforcement`'s `PoliceFeed`).

## The defect found — "Enter" was fabricated success

This is the one real defect, and it's the lens's single most consequential
feature: **spawning a sub-world and clicking "Enter" never actually took you
anywhere.**

### Root cause, traced end to end

1. `server/domains/sub-worlds.js#visit` returns a hand-off contract —
   `{ travel: { destination_world_id, name, kind } }` — with a comment
   literally saying "the page routes the user into the existing world-travel
   system with this destination." **Nothing ever consumed that contract.**
2. `app/lenses/sub-worlds/page.tsx`'s old `visit()` handler called the macro,
   then just `flash()`ed a status string — `` `Entering "${w.name}" — routing
   to world-travel (${dest}).` `` — and stopped. No navigation, no call into
   any travel hook, no state change beyond a 4-second toast. Every click on
   "Enter" was 100% cosmetic.
3. Even if the frontend HAD called the real travel system
   (`useWorldTravel()` → `POST /api/worlds/travel` → `routes/worlds.js` →
   `server/lib/transit.js#travelToWorld` → `server/lib/world-loader.js
   #loadWorld`, `SELECT * FROM worlds WHERE id = ? AND status = 'active'`),
   it would have **404'd** — spawning a sub-world only ever wrote to the
   in-memory `STATE.subWorldsLens` map, never to the real `worlds` SQL table
   (migration `042_concordia_worlds.js`) that `loadWorld` reads. Verified by
   reading `spawn`'s full body pre-fix: it does `userWorlds(s,
   actor(ctx)).push(w); save();` and returns — no `db` touch at all.

This is exactly the class of defect CLAUDE.md's sixth hard invariant names:
"a share link that 404'd on every use while its UI implied success." Here the
UI didn't even reach the point of 404ing — the click did nothing beyond
incrementing a counter and printing a sentence that claimed a trip that never
started.

**Triage: ENGINEERING**, not DATA-SOURCING or CURATION — no external data
dependency, just two missing wires: (a) the backend needs to mirror a
travelable row into the real `worlds` table, (b) the frontend needs to
actually call the real travel system. Both closed this pass.

## What changed

### 1. `server/domains/sub-worlds.js` — mirror spawned worlds into the real `worlds` table

Added three small helpers (`mirrorWorldRow`, `setWorldRowStatus`,
`deleteWorldRow`), all best-effort (`ctx?.db` may be absent in unit tests or
minimal builds — every call is wrapped in try/catch and never blocks the
in-memory STATE path, which stays canonical):

- **`spawn`** — after the in-memory record is created, `INSERT INTO worlds
  (id, name, universe_type, description, created_by, status) VALUES (…,
  'active') ON CONFLICT(id) DO UPDATE …` using the sub-world's own
  `world_id`/`name`/`kind`(→`universe_type`)/`description`. This is the
  single fix that makes "Enter" resolvable at all — `loadWorld` can now find
  the row.
- **`update_settings`** — keeps the mirrored row's `name`/`description` in
  sync so the 3D world lens (and `GET /api/worlds`, which the canonical
  `/lenses/world/travel` terminal reads from) shows consistent metadata.
- **`archive`** — soft archive now also `UPDATE worlds SET status =
  'archived'`, matching `loadWorld`'s own `AND status = 'active'` filter (so
  an archived sub-world is honestly unreachable via real travel, consistent
  with the domain's pre-existing in-memory `visit` refusal for archived
  worlds). `hardDelete` now also `DELETE FROM worlds WHERE id = ?`.
- Deliberately **not** synced: `set_status('paused')` does not touch the
  `worlds.status` column. The domain's own `visit` macro does not block
  paused worlds (only archived + private-without-access are blocked), so
  syncing `paused` → a non-`'active'` `worlds.status` would make a world the
  lens itself considers enterable 404 in the real travel path — a new
  inconsistency, not a fix. Left as a documented design choice, not an
  oversight.

### 2. `concord-frontend/app/lenses/sub-worlds/page.tsx` — `visit()` now performs a real cross-world jump

Imports `useRouter` (`next/navigation`), `useWorldTravel` (the exact hook
`/lenses/world/travel` — the canonical world-travel terminal — already uses),
and `PortalLoadScreen` (the shared, honest-by-construction full-screen travel
overlay: real phases `requesting → spawning → loading-assets → complete`,
never a fake progress bar). New `visit(w)`:

1. Calls `sub_worlds.visit` first (unchanged) — this is still the privacy/
   archived gate and the visitor-counter increment, and it fails closed with
   an honest error if refused.
2. Only on success, calls `await travelHook.travel(w.world_id)` — the real
   `POST /api/worlds/travel` round-trip, scene-teardown wait, and
   `activeWorldId` write.
3. Only on travel success, `router.push('/lenses/world')` — actually lands
   the player in the 3D scene.
4. On travel failure (e.g. a sub-world spawned before this fix, before a
   backend redeploy carries the mirror), flashes an honest error naming the
   world and the failure reason — never silently succeeds, never navigates
   anywhere it can't back up.

`WorldCard.tsx` gained a `traveling?: boolean` prop — the Enter button shows
a `Loader2` spinner + "Entering…" and disables while a real network round
trip is in flight (was previously always instantly "successful," which was
itself a tell that nothing real was happening — a genuine cross-world jump
takes real time to spawn a shard/scene).

## Macro → UI classification (all 15 macros)

**DESIGNED** — 15/15, unchanged coverage, one hand-off now genuinely wired:

| Macro | Where | Note |
|---|---|---|
| `spawn` | Spawn form (page.tsx) | now also mirrors a real `worlds` row |
| `list` | My Worlds tab | — |
| `discover` | Discover tab + filters | — |
| `update_settings` | `WorldSettingsPanel` | now also syncs the mirrored row |
| `set_status` | `WorldSettingsPanel` + WorldCard owner-manage button | — |
| `archive` | `WorldSettingsPanel` (soft + hard delete) | now also archives/deletes the mirrored row |
| `visit` | WorldCard "Enter" button | **now hands off to the REAL `useWorldTravel` + `router.push`, not a toast** |
| `favorite` / `my_favorites` | WorldCard star button + Favorites tab | — |
| `analytics` | `WorldAnalyticsPanel` (14-day `ChartKit` bar timeline) | — |
| `invite_editor` / `remove_editor` | `WorldSettingsPanel` co-editors list | — |
| `editor_state` / `editor_add_block` / `editor_remove_block` | `WorldEditorPanel` | — |

## Investigated and honestly deferred

- **A sub-world's `worlds` row is a bare-minimum shell** — no
  `physics_modulators`/`rule_modulators` beyond the table defaults (`'{}'`),
  no `world_substrate_dtus`, no seeded NPCs/biome/skybox theme. A player who
  "Enter"s a freshly spawned sub-world lands in the 3D scene, but it reads as
  a blank Concordia instance, not a bespoke physics-sim/research-zone/
  substrate space matching the sub-world's declared `kind`. Closing this
  gap fully (per-`kind` starting `rule_modulators`/`physics_modulators`
  presets, or routing the in-place block editor's `terrain`/`prop`/`light`
  blocks into `world_substrate_dtus`) is real **ENGINEERING** work, but it's
  a distinct, larger unit than "make Enter actually enter" — this pass
  closes the honesty gap (the click does what it claims), not the full
  world-authoring-fidelity gap. Flagged here as the next real increment,
  not silently dropped.
- **The legacy singular `sub_world.spawn_from_forge` macro** (inline in
  `server.js`, writes to its own `sub_worlds` SQL table) has the identical
  "never mirrors to the real `worlds` table" defect and is reachable via
  `runMacro`/MCP, just not from this lens's frontend. Out of scope for a
  frontend-lens unit — flagged for a future backend-hygiene pass, not fixed
  here (no frontend caller exercises it, so it's not this lens's "Enter"
  bug, but it is the same bug pattern living on in dead-adjacent code).

## Verification

```
node --check server/domains/sub-worlds.js                          # OK
cd server && node --test tests/sub-worlds-lens-macros.test.js \
  tests/sub-worlds-domain-parity.test.js \
  tests/sub-worlds-real-worlds-mirror.test.js \
  tests/world-flavor-loader.test.js tests/world-travel.test.js \
  tests/world-shard-travel-wiring.test.js
# → 59/59 pass, 0 fail
# (sub-worlds-real-worlds-mirror.test.js is new this pass — proves the
#  mirror via the REAL loadWorld() helper the travel route actually calls,
#  not a reimplementation of the read)

cd concord-frontend && npx eslint app/lenses/sub-worlds/page.tsx \
  components/sub-worlds/WorldCard.tsx tests/sub-worlds-lens-states.test.tsx
# → clean, 0 errors/warnings

npx vitest run tests/sub-worlds-lens-states.test.tsx
# → 9/9 pass (7 pre-existing + 2 new: real travel hand-off + honest
#   failure-surfacing, both driving the actual page state machine)

node scripts/verify-lens-backends.mjs
# → {"WIRED":258,"NO-BACKEND-CALL":2} total 260 (unchanged — sub-worlds was
#   already WIRED; this pass fixed depth, not reachability)

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json sub-worlds entry: tier "polished",
#   isGenericScaffold: false, bespokeRatio 0.649, pillarsPresent 5/5,
#   antiPatterns 0
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
