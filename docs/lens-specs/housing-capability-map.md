# Housing Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.
> **Confirmed distinct from `household`** (the home-inventory/chores/family
> lens) — `housing` is the Concordia in-world player-housing system
> (claim a building inside a land claim, decorate rooms, lock doors, allow
> visits). No shared components, domain files, or routes between the two.

## Backend surface

```
grep -c 'register("housing"' server/domains/housing.js
```
→ **9** macros in `server/domains/housing.js` (196 lines): `mine`, `get`,
`public`, `claim`, `place_furniture`, `remove_furniture`, `set_visibility`,
`set_live_visits`, `set_lock`, `visit` (10 `register(` call sites — `mine`
appears once, count includes the file's own doc-comment references). No
inline `register("housing"...)` calls exist in `server.js`.

**The domain file's own header comment explains the architecture**
(`server/domains/housing.js:1-24`): the lens reaches the substrate through
9 REST routes under `/api/housing/*` (`server.js:50841-50900` +
`:52524`), and this macro file is a *parallel* adapter exposing the SAME
`server/lib/player-housing.js` + `server/lib/house-visit.js` functions
through `runMacro` so the ⌘K palette / Orchestrated Invariant Engine can
reach it too. `page.tsx` calls the REST routes directly (not `lensRun`) —
this is the documented, intentional pattern, not a miswiring.

`node scripts/lens-unsurfaced.mjs --lens housing` is **not reliable here**:
the script only checks for macro-call-site references
(`runDomain`/`lensRun('housing', …)`), and since the page calls the REST
routes instead, it would misreport every macro as unsurfaced. Verified
independently instead by grepping `page.tsx` against every REST route in
`server.js`.

## What was real vs. fake — and the one genuine gap

8 of 9 backend operations were already wired and exercised end-to-end in
`page.tsx`: `mine` (My Houses list), `get` (house detail + rooms),
`public` (Visit tab browse), `place_furniture`/`remove_furniture` (per-room
grid editor with live x/y/z/rot), `set_visibility`, `set_live_visits`,
`set_lock` (per-room lock tier 0-5), `visit` (Visit tab → POST visit).

**Gap found: `housing.claim` (`POST /api/housing/claim`) had ZERO frontend
call sites anywhere in the codebase** (`grep -rn "housing/claim\|claimHouse"
concord-frontend/` before this wave's fix returned only the route + lib
definitions, no caller). The empty state literally instructed the user
to "claim a land plot, place a building, then claim it as a house" but
there was no UI anywhere to perform that third step — a real macro/route
with zero reachable UI, the exact "unsurfaced macro cluster" defect class
from the wave's brief, just hidden behind a REST-route pattern instead of
a macro-call-site pattern (so the static unsurfaced-scanner couldn't see
it either way).

## What changed this wave

Added a "Claim a house" panel to the My Houses tab (`page.tsx`):
1. Toggle button next to the "My houses" header (and a link from the empty
   state) opens the panel.
2. On open, calls `land_claims.list_for_user` via `lensRun` (the one macro
   call site in this file — chosen because there is no REST equivalent
   list endpoint scoped to the caller) to list the player's own active
   land claims.
3. Selecting a claim fetches `GET /api/worlds/:worldId/buildings` and
   filters client-side to buildings whose `(x,z)` falls within the claim's
   `anchor_x/anchor_z/radius_m` circle (mirrors the exact geometry check
   `claimHouse` itself performs server-side, so a building that would be
   rejected never appears as clickable) and excludes buildings already
   claimed as a house (diffed against `myHouses`).
4. Clicking a building POSTs `/api/housing/claim` with `{ landClaimId,
   buildingId, name }`, then refreshes the house list and re-loads the
   claim's building list (so a claimed building disappears from the
   claimable set without a page reload).

No new backend code — this wires existing, real macros/routes
(`land_claims.list_for_user`, `GET /api/worlds/:worldId/buildings`,
`POST /api/housing/claim`) that had correct server-side logic but no
consumer.

Files touched:
- `concord-frontend/app/lenses/housing/page.tsx` — added `LandClaim` /
  `WorldBuilding` types, claim-flow state, `refreshClaims` /
  `loadClaimBuildings` / `claimAsHouse` handlers, and the claim panel JSX.

## Verification

- `cd concord-frontend && npx eslint app/lenses/housing/page.tsx` → clean.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors attributable to
  this file.
- `cd server && node --test tests/housing-domain-macros.test.js
  tests/land-claims.test.js tests/player-housing.test.js` → 38/38 passing
  (pre-existing; no server file was touched this wave — the fix was
  entirely wiring existing, already-tested backend surface).
