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

~~**Genuinely minor gap, worth naming**: `courtship.dissolve` /
`dissolveMarriage` has **zero UI caller anywhere** — there is no
"end this marriage" action exposed to the player in this lens (marriages
currently only end via the automatic `spouse-reactivity.js` estrangement
path below −0.3 affinity, not a manual player choice). This is a real,
minor scope gap, not fabricated data or a regression — flagging it for a
future pass rather than fixing it here (documentation-only task).~~

**CLOSED (2026-07-12, `7bf37520`)** — Frontend Rebuild Program Wave 4
gap-closure unit. What shipped:

- **`ConfirmDissolveModal`** (`concord-frontend/components/courtship/
  ConfirmDissolveModal.tsx`, new file) — a real confirm-then-commit dialog
  (not a bare destructive button), styled after the sibling `HeartEventModal`
  in this same directory: same overlay/`role="dialog"`/focus-management/
  Escape-key idiom, red/danger palette. Focus defaults to Cancel so an
  accidental Enter can't trigger the destructive action.
- **`page.tsx`** — each active-marriage row now has an "End Marriage" button
  (`aria-label="End marriage to {partnerId}"`) that opens the modal via
  `dissolveTarget` state. Confirming calls
  `POST /api/lens/run { domain:'courtship', name:'dissolve', input:{marriageId, reason:'estranged'} }`
  (the macro dispatcher path, same idiom this page already uses for
  `conceive`/`birth`). On success: success toast, modal closes, `refresh()`
  re-fetches — the dissolved marriage naturally drops out of the active
  `/api/courtship/marriages/mine` list. Cancel closes the modal without ever
  calling the macro.
- **New "Past marriages" section** — sourced from
  `courtship.marriages{activeOnly:false}` (a read the macro already
  supported; the REST route only ever returns active marriages), filtered
  client-side to rows carrying a real `dissolved_at`. This is the "moved to
  a past-marriages state" half of the task — genuinely backend-grounded, not
  a locally-fabricated "ended" flag.
- **Real authz gap found and fixed while wiring this** (not present in the
  original finding, discovered during implementation): `courtship.dissolve`
  took **no `ctx.actor.userId` at all** — it only checked `input.marriageId`
  existed, then called `dissolveMarriage(db, marriageId, reason)` with zero
  ownership check. Any authenticated caller who knew (or enumerated) a
  `marriageId` could dissolve *any other player's* marriage. Fixed in
  `server/lib/romance-engine.js#dissolveMarriage`, which now takes an
  optional 4th `expectedUserId` param and rejects with `{ok:false,
  reason:'not_a_party'}` when the marriage's `player_user_id` doesn't match;
  both `courtship.dissolve` and the sibling `romance.dissolve` (same
  underlying lib fn, same gap, `server/domains/romance.js`) now require
  `ctx.actor.userId` and pass it through. The param is optional/back-compat
  so no other caller (tests, internal system code) broke — confirmed no
  `runMacro("courtship"|"romance", "dissolve", …)` call sites exist anywhere
  in production code, and the automatic estrangement path
  (`spouse-reactivity.js`) does its own direct SQL, never calling
  `dissolveMarriage`.
- **Tests**: `server/tests/courtship-domain-macros.test.js` gained 4 new
  cases — valid dissolve ends an active marriage (real DB row transition,
  disappears from active list, still queryable via `activeOnly:false`),
  rejects a non-party caller (`not_a_party`, marriage untouched), rejects a
  nonexistent marriage (`marriage_not_found`) and an already-dissolved one
  (`already_dissolved`), and the standard no-db/no-user/missing-input
  guards. New frontend test file
  `concord-frontend/tests/courtship-dissolve.test.tsx` (5 cases): the button
  renders, opening the modal doesn't call dissolve, Cancel never calls
  dissolve, confirming calls the real macro and updates both the active and
  past-marriages lists, and a server-side rejection (`not_a_party`) surfaces
  an error toast without fabricating a success.
- **Verification**: `node --check` clean on all 3 touched backend files;
  `npx eslint` 0 errors/warnings (backend + frontend); backend suite
  `courtship-domain-macros.test.js` 13/13 (9 pre-existing + 4 new), sibling
  `romance-engine.test.js` + `spouse-reactivity.test.js` +
  `depth/romance-behavior.test.js` 35/35 unaffected by the lib signature
  change; frontend `vitest run` 17/17 across the 3 courtship test files (5
  new); `tsc --noEmit -p .` 0 errors project-wide.

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
gap — the missing manual "dissolve marriage" UI action — is now **CLOSED**
(see above); it also surfaced and fixed a real authz gap in the
`dissolve` macro along the way.

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"courtship\"\|register(\"courtship\"" server/domains/courtship.js server/server.js` — 13 macros registered at `server/domains/courtship.js:52,65,81,96,110,123,139,150,163,177,188,201,221`; none registered inline in `server.js`.
- `wc -l server/domains/courtship.js` — 224.
- Backend tests found: `server/tests/courtship-domain-macros.test.js` (9 tests), `server/tests/romance-engine.test.js`, `server/tests/spouse-reactivity.test.js`, `server/tests/daily-life.test.js`, `server/tests/social-gatherings.test.js`, `server/tests/depth/romance-behavior.test.js`.
- `node --test server/tests/courtship-domain-macros.test.js` — **9/9 passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `courtship` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).

## Verification (dissolve-action closure, 2026-07-12)

- `node --check server/domains/courtship.js server/domains/romance.js server/lib/romance-engine.js` — clean.
- `cd server && npx eslint domains/courtship.js domains/romance.js lib/romance-engine.js tests/courtship-domain-macros.test.js` — 0 errors/warnings.
- `DB_PATH=/tmp/courtship-verify-<ts>.db NODE_ENV=test node --test server/tests/courtship-domain-macros.test.js` — **13/13 passing** (9 pre-existing + 4 new: valid dissolve, non-party rejection, not-found/already-dissolved rejection, guards).
- `DB_PATH=/tmp/courtship-verify2-<ts>.db NODE_ENV=test node --test server/tests/romance-engine.test.js server/tests/spouse-reactivity.test.js server/tests/depth/romance-behavior.test.js` — **35/35 passing**, confirming the `dissolveMarriage(db, marriageId, reason, expectedUserId?)` signature change is fully back-compat.
- `cd concord-frontend && npx vitest run tests/courtship-dissolve.test.tsx tests/courtship-lens-states.test.tsx tests/components/CourtshipLensPage.test.tsx` — **17/17 passing** (5 new in `courtship-dissolve.test.tsx`).
- `cd concord-frontend && npx eslint app/lenses/courtship/page.tsx components/courtship/ConfirmDissolveModal.tsx tests/courtship-dissolve.test.tsx` — 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` — 0 errors project-wide.
