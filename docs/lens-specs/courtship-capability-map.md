# Courtship lens — capability map (backfill, 2026-07-11)

## What this lens actually is

An in-world romance/marriage/pregnancy tracker for the Concordia 3D world
simulator, over the `courtship` domain (`server/domains/courtship.js`, 224
LOC, 13 macros, all thin delegations to `server/lib/romance-engine.js` and
`server/lib/spouse-reactivity.js`). The actual courtship *interaction*
entry point (talk/propose/wed an NPC) lives in the 3D world — the NPC
Action Menu's "Court" option — and the parallel REST routes
(`server.js:51041-51099`) call the same engine functions directly,
bypassing the macro registry. This lens's own page is the "my
relationships" dashboard: active courtships, marriages, pending
pregnancies, and children.

This lens was rebuilt in an earlier wave of the Frontend Rebuild Program
(commit `25e58421`, "feat(courtship): wire orphaned HeartEventModal +
pregnancy-cache", 2026-07-09, finishing WIP left by an earlier commit
`07e0e660`) — before the `docs/lens-specs/*-capability-map.md` doc
convention existed. This doc backfills that gap against the current code.

**Frontend:**
- `concord-frontend/app/lenses/courtship/page.tsx` — 506 LOC. Fetches
  `/api/courtship/mine` + `/api/courtship/marriages/mine` (REST), calls
  `/api/lens/run` for `courtship.constants`/`conceive`/`birth`. Renders
  active courtships (affinity bar, Interact/Propose/Wed buttons gated by
  live thresholds from `courtship.constants`), marriages, pending
  pregnancies, and children — all bespoke Tailwind UI.
- `concord-frontend/components/courtship/HeartEventModal.tsx` (105 LOC) —
  modal displaying an authored `heartEvent` scene object returned by
  `/api/courtship/interact`. Was orphaned/unmounted before this rebuild.
- `concord-frontend/components/courtship/pregnancy-cache.ts` (65 LOC) —
  per-user localStorage cache (`concord:courtship:pregnancies:${userId}`)
  for pending pregnancies, since no backend list-pregnancies macro exists.
  Was written but unused before this rebuild.
- `concord-frontend/components/world/CourtshipProgressOverlay.tsx` — a
  separate in-world 3D overlay (mounted in `app/lenses/world/page.tsx`),
  polls `/api/courtship/mine` every 30s (`useClientConfig().poll.
  courtshipMs`), filters to `partner_kind==='npc'`, draws heart/⚭ icons
  above wedded/courting NPCs.
- `concord-frontend/components/world/NPCActionMenu.tsx` — the "Court"
  action, calling `/api/courtship/npc/:id` + `/api/courtship/interact` —
  the actual in-3D-world courtship-initiation entry point (the lens page's
  empty state correctly points users there).

**Backend macro registrations** (`server/domains/courtship.js`):
`list` (:52), `get` (:65), `interact` (:81), `propose` (:96), `wed`
(:110), `marriages` (:123), `dissolve` (:139), `conceive` (:150), `birth`
(:163), `children` (:177), `spouses` (:188), `spouse_react` (:201),
`constants` (:221).

## Findings — verify pass, one minor documented gap

**HeartEventModal + pregnancy-cache verification**: both are genuinely
mounted and functioning — confirmed by real import + usage in `page.tsx`
(lines 39-45, 88-92, 188-193, 497-503 for the modal; 41-45, 96-97, 227-247,
249-286, 419-468 for the cache). Commit `25e58421` finished this WIP,
touching only `page.tsx` (+200/-6 lines), and matches the historical claim
exactly.

**Wiring cross-check**: the lens page calls only 3 of 13 macros directly
via `/api/lens/run` — `constants`, `conceive`, `birth`. The remaining 10
(`list`, `get`, `interact`, `propose`, `wed`, `marriages`, `dissolve`,
`children`, `spouses`, `spouse_react`) have no direct macro caller from
this lens, but this is **not** a wiring gap for most of them: their
underlying lib functions (`listMyCourtships`, `courtInteraction`,
`propose`, `wed`, `listMyMarriages`, `listChildren`, `getSpouses`) are
reached through the parallel REST routes instead, which the page and the
world-lens overlay actually call. `spouse_react`
(`reactToPlayerEvent`) is invoked directly from `routes/worlds.js` on an
NPC-kill event, never via the macro.

**Genuinely minor gap, worth naming**: `courtship.dissolve` /
`dissolveMarriage` has **zero UI caller anywhere** — there is no
"end this marriage" action exposed to the player in this lens (marriages
currently only end via the automatic `spouse-reactivity.js` estrangement
path below −0.3 affinity, not a manual player choice). This is a real,
minor scope gap, not fabricated data or a regression — flagging it for a
future pass rather than fixing it here (documentation-only task).

**Fabricated data**: none. No `Math.random()`, `mock`, `fake`, or
placeholder strings anywhere in the lens files or `courtship.js`. Numeric
randomness (pregnancy due dates, hook generation) lives entirely in
`romance-engine.js`/`spouse-reactivity.js`, untouched by this lens.

**Generic-scaffold check**: clean — no `UniversalActions`/
`LensFeaturePanel`/`ManifestActionBar`/`AutoActionStrip`/`RecentMineCard`
references; every button is a designed, state-specific action.

**Historical-claim verification**: confirmed exactly by commit `25e58421`
— eslint/tsc clean, 12/12 pre-existing courtship tests green at the time
of the commit.

**Overall verdict**: fully wired, no fabrication, no generic scaffold.
Propose/marry thresholds correctly source from the backend engine (no
hardcoded duplicate constants in the frontend beyond the documented
`MIN_AFFINITY_TO_PROPOSE = 0.60` CLAUDE.md already calls out as an
intentional client-side gate). Both previously-orphaned WIP files are
real, mounted, honest-by-construction components. The one true residual
gap is the missing manual "dissolve marriage" UI action, which is a scope
note, not a defect.

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"courtship\"\|register(\"courtship\"" server/domains/courtship.js server/server.js` — 13 macros registered at `server/domains/courtship.js:52,65,81,96,110,123,139,150,163,177,188,201,221`; none registered inline in `server.js`.
- `wc -l server/domains/courtship.js` — 224.
- Backend tests found: `server/tests/courtship-domain-macros.test.js` (9 tests), `server/tests/romance-engine.test.js`, `server/tests/spouse-reactivity.test.js`, `server/tests/daily-life.test.js`, `server/tests/social-gatherings.test.js`, `server/tests/depth/romance-behavior.test.js`.
- `node --test server/tests/courtship-domain-macros.test.js` — **9/9 passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `courtship` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).
