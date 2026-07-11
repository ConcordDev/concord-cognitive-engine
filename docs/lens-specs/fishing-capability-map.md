# Fishing lens — capability map (backfill, 2026-07-11)

## What this lens actually is

A species catalog + catch log hub over the `fishing` domain
(`server/domains/fishing.js`, 194 LOC, 9 macros, all thin delegations to
`server/lib/fishing.js`, 209 LOC). The live cast/bite/reel interactive
session is a **separate, real, shared component**
(`concord-frontend/components/world-lens/FishingMinigameOverlay.tsx`, 232
LOC) mounted by both this hub page and the 3D world's "press F near
water" entry point — it is not owned or duplicated by this lens's own
macro surface.

This lens was rebuilt in an earlier wave of the Frontend Rebuild Program
(commit `13f3734d`, "rebuild as species catalog + catch log app, disclose
live session gap honestly", Phase 3 Wave 1, 2026-07-09) — before the
`docs/lens-specs/*-capability-map.md` doc convention existed. This doc
backfills that gap against the current code.

**Frontend:**
- `concord-frontend/app/lenses/fishing/page.tsx` — 327 LOC. Carries an
  extensive in-code capability-map header comment (step 1 of the rebuild
  loop) dated 2026-07-09/10.
- `concord-frontend/components/fishing/SpeciesCatalog.tsx` (195 LOC) —
  biome-filterable `DataTable` with facet chips.
- `concord-frontend/components/fishing/CatchLog.tsx` (130 LOC) — real
  catch history, highlight-on-new-catch.
- `concord-frontend/components/fishing/SpeciesDetailModal.tsx` (129 LOC)
  — per-fish descriptor modal, a second network call.
- `concord-frontend/components/world-lens/FishingMinigameOverlay.tsx`
  (232 LOC) — the real cast/bite/reel session UI: cast → wait-for-bite
  (a `crypto.randomBytes`-seeded delay, not `Math.random`) → a
  tension-timing reel minigame (keyboard W/S drift-based tension bar,
  sampled every 100ms) → weighted-random catch resolution via
  `resolveFishCatch` (a legitimate `Math.random()`-weighted RNG over the
  biome candidate pool — a real game mechanic, not fabricated display
  data).

**Backend macro registrations** (`server/domains/fishing.js`):
`catalog` (:44), `species` (:55), `list` (:65, generic alias of
`catalog`), `get` (:74), `catches` (:86), `session` (:111, read-only
introspection), `cast` (:131), `reel` (:180), `create` (:191, alias of
`reel` via shared `doReel`). A separate, older, unrelated macro
`fishing.resolve_cast` also exists in `server/domains/minigames.js`
(a Phase-II life-sim resolver) — a distinct legacy code path this lens
does not use.

## Findings — the historical claim needed a correction

**The live bite/cast session is real and present — it is NOT missing.**
The historical ledger phrase "honest disclosure of a live bite/cast
session gap" is easy to misread as "no live minigame exists." That is
**not** what's true in current code: `FishingMinigameOverlay` implements a
genuine three-phase cast→bite→reel flow and is mounted directly behind a
"Cast line" button on this hub page (shared verbatim with the 3D world's
entry point).

What **is** honestly disclosed as unsurfaced is narrower: only the
`fishing.session` **read-only introspection** macro (a peek at an open
session's bite timing / candidate count) has no UI consumer. The page's
own header comment states this explicitly: *"`fishing.session`
UNSURFACED, honestly. Session lifecycle (bite timing / tension accuracy)
is fully owned end-to-end by the shared `FishingMinigameOverlay` — this
hub page never holds a `sessionId` of its own, so there is no real place
to inspect one without duplicating that component's state machine. Not
faked."* The rebuild commit `13f3734d` also fixed a real pre-existing bug
in this hub page: the old page pre-cast a throwaway session before opening
the overlay (which cast again internally), double-casting per click. That
bug is now gone — `handleCast` has no pre-fetch.

**Wiring cross-check**: `catalog`, `species`, `get`, `catches` are called
via `lensRun` from `page.tsx`/`SpeciesDetailModal`. `cast`/`reel` are
**not** called via the macro system from the frontend — the live minigame
hits REST routes `/api/fishing/cast` and `/api/fishing/:sessionId/reel`
directly (thin wrappers over the same `server/lib/fishing.js` functions
the macros delegate to; macros exist for the invariant-engine/mobile
client per the domain file's own header comment, REST serves the UI).
`list` and `create` are generic-manifest aliases, not separately surfaced.
`session` has zero UI callers (see above — intentional).

**Fabricated data**: none found. No `Math.random()` in any render path, no
mock/fake/placeholder/lorem content. Comments explicitly call out avoiding
fake behavior ("Not faked," "never a timed fake animation, only triggered
when the real data actually changed"). The `Math.random()` usage that does
exist lives in `server/lib/fishing.js` and is legitimate weighted-RNG
catch selection, a real game mechanic.

**Generic-scaffold check**: clean — `SpeciesCatalog`/`CatchLog`/
`SpeciesDetailModal` are bespoke, not a `ManifestActionBar`/
`UniversalActions` wall.

**Historical-claim verification**: two relevant commits — `6c77c851`
(2026-06-28, an earlier polish pass fixing catalog silent-empty error
surfacing) and `13f3734d` (2026-07-09, the actual Phase 3 Wave 1 rebuild
that produced the current state).

**Overall verdict**: not a regression, not silently faked. The gap is real
but narrower than the one-line ledger summary suggests — the correct
framing is "the `fishing.session` introspection macro is honestly
unsurfaced by design (the live overlay owns its own session state); the
actual live cast/bite/reel mechanic is real, implemented, and shared
between this hub and the 3D world," not "no live session exists."

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"fishing\"\|register(\"fishing\"" server/domains/fishing.js server/server.js` — 9 macros registered at `server/domains/fishing.js:44,55,65,74,86,111,131,180,191`; none registered inline in `server.js`.
- `wc -l server/domains/fishing.js server/lib/fishing.js` — 194 + 209 = 403 total.
- Backend tests found: `server/tests/fishing-domain-macros.test.js`, `server/tests/fishing-lens-macros.test.js`, `server/tests/fishing.test.js`, `server/tests/minigame-resolvers.test.js`, `server/tests/ocean-spotlog-domain-parity.test.js`. Frontend: `concord-frontend/tests/fishing-lens-states.test.tsx`, `concord-frontend/tests/lenses/fishing-page.test.tsx`.
- `node --test server/tests/fishing-domain-macros.test.js server/tests/fishing.test.js` — **all passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `fishing` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).
