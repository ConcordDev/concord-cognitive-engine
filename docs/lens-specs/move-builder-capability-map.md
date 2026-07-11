# Move-builder lens — capability map (Wave 3, 2026-07-11)

## What this lens actually is

MS-P2 — the Universal Move System's player-facing move-creation surface: pick
element + skill-kind, allocate a diminishing-returns modifier budget (City of
Heroes Enhancement-Diversification "Schedule A" shape — stacking the same
aspect gives full value for the first couple of points then a sharp cliff, so
the optimal build spreads across aspects), preview exactly how it will animate
via the server's real move-descriptor (the same twin the client's combat
resolver reads), then mint it as a real `move_recipe` DTU.

Backend: `server/domains/move-builder.js` — a documented prior fix ("previously
pointed at PHANTOM, unregistered macros — this file makes those real"), a thin
delegation layer with no combat/animation logic of its own; all real
computation lives in `server/lib/move-descriptor.js`. 5 macros: `compose`
(pure preview), `mint` (compose + persist), `list`, `get`, `catalog`.

## Finding: `move-builder.get` had zero UI caller

4 of 5 macros were already wired (`catalog`, `list`, `compose`, `mint`). The
minted-moves list only ever rendered a flat `name · element · kind · tier`
card — there was no way to see a committed move's actual stamped motion
descriptor (the same shape the live compose preview shows before minting).

## Fix

Made each minted move in "Your moves" expandable: clicking it calls
`move-builder.get` and shows the round-tripped motion descriptor (motion
family/archetype, effect archetype, resource gauge, leading limb) plus the
allocation and over-invested warning, matching the same descriptor language
the pre-mint preview already uses. Collapsing doesn't re-fetch; re-expanding a
different move does.

## Verification (all run directly, 2026-07-11)

- `npx eslint app/lenses/move-builder/page.tsx tests/move-builder-lens-wired.test.tsx` — clean, 0 issues.
- `npx vitest run tests/move-builder-lens-wired.test.tsx` — **7/7 passing** (2 new: expand renders the real `get` response, and a `get` failure renders `role="alert"` with a working Retry — caught and fixed a real bug during test-writing where the Retry button called the same toggle handler used for expand/collapse, so clicking Retry while already expanded collapsed the panel instead of re-fetching; split into a dedicated `fetchDetail` used by both the initial expand and Retry).
- `node --test server/tests/move-builder-domain-macros.test.js` — **11/11 passing** (no backend changes — `move-builder.get` was already correct and tested, just unsurfaced).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `move-builder`: `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward.
