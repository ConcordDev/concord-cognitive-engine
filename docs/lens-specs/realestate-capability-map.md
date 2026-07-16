# Real Estate Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface — TWO domains, one lens

```
grep -c 'registerLensAction("realestate"' server/domains/realestate.js   # → 55
grep -c 'register("real_estate"'          server/domains/real-estate.js # → 10
```

**Domain-string trap (per the assignment brief's warning) — the severe
finding this pass exists to fix.** Two separate backend files serve this one
lens, registered under two different domain strings:

- `server/domains/realestate.js` (1394 lines, **55** macros registered via
  `registerLensAction("realestate", ...)`) — a personal real-estate
  CRM/search/calculator suite: mortgage/affordability/rent-vs-buy/cap-rate/
  cash-flow calculators, a per-user listings CRUD store (search/favourite/
  tour/compare/notes/price-history/photos), agent messaging, mortgage
  pre-approval, saved-search alerts, and a Census-ACS live feed. Domain
  string matches the lens name exactly, so `verify-lens-backends.mjs` and
  every frontend `lensRun({ domain: 'realestate', ... })` call resolves it
  correctly.
- `server/domains/real-estate.js` (123 lines, **10** macros registered via
  plain `register("real_estate", ...)`, backed by
  `server/lib/real-estate-engine.js`) — a genuine **in-world property
  market**: `list_for_sale`, `delist`, `active_listings`, `purchase`,
  `owned`, `lease`, `dissolve_lease`, `my_rentals`, `tick_rentals`,
  `constants`. It operates on real `world_buildings` rows (Concordia
  building ownership), `property_listings`, and `rental_agreements` — a
  player who owns an in-world building (`owner_type='player'`) can list it
  for sale, another player can `purchase` it (real wallet debit/credit via
  `economy/wallet.js`, transactional ownership transfer), and buildings can
  be leased to player or NPC tenants with recurring rent collection. This is
  a completely different capability from the `realestate.js` personal-CRM
  listings above — it moves real Concordia-world assets between real
  players, not user-authored placeholder listings.

**Before this pass, the entire `real_estate` (underscore) domain was dark.**
The only reference to it anywhere in the lens frontend was:

```tsx
<LensFeaturePanel lensId="real_estate" />
```

at `app/lenses/realestate/page.tsx:3366`, inside a collapsed "Lens Features
& Capabilities" section — the generic spec-listing fallback component
(`components/lens/LensFeaturePanel.tsx`), not a real UI. None of the 10
`real_estate.*` macros were ever called by any component. This is the same
defect shape as the home-improvement lens's disconnected-Projects-tab
finding (`docs/lens-specs/home-improvement-capability-map.md`): real,
substantial, transactional backend depth sitting completely unreachable
behind a naming mismatch and a generic placeholder.

Cross-reference method: grepped every `action:`/`lensRun(` call site across
`app/lenses/realestate/page.tsx` (3512 lines) and all 22
`components/realestate/*.tsx` files against both macro lists.

## Classification

### `realestate.*` (55 macros) — all DESIGNED, all reachable

Every one of the 55 macros in `realestate.js` has a real, bespoke calling
component (not a generic button wall):

| Macro | Caller |
|---|---|
| `capRate`, `cashFlow`, `closingTimeline`, `vacancyReport` | `DOMAIN_ACTIONS` buttons across Transactions/Rentals/Investing tabs + `handleAction` |
| `calc-mortgage`, `calc-affordability`, `calc-rent-vs-buy`, `saved-searches-list`, `save-search`, `delete-search` | `RealEstateWorkbench.tsx` |
| `neighborhood-stats` | `NeighborhoodStats.tsx` (real Census Geocoder + ACS 5-year lookup, free/no-key) |
| `listings-list`, `listings-add`, `listings-get`, `listings-delete`, `listings-search`, `favourites-list`, `favourites-toggle` | `ListingsBrowser.tsx`, `ListingDetailDrawer.tsx`, `FavouritesPanel.tsx` |
| `tours-list`, `tours-request`, `tours-cancel` | `ToursPanel.tsx` |
| `avm-estimate` | `AVMEstimator.tsx` |
| `school-ratings`, `walk-score`, `commute-estimate` | `SchoolWalkPanel.tsx` |
| `hot-score` | `ListingDetailDrawer.tsx` |
| `parse-search-query` | `AISearchBar.tsx` |
| `compare` | `PropertyCompare.tsx` |
| `agents-list`, `agents-add`, `agent-message`, `messages-list` | `AgentMessenger.tsx`, `ContactAgentForm.tsx` |
| `open-houses-upcoming` | `OpenHouseCalendar.tsx` |
| `notes-list`, `notes-save`, `notes-delete` | `PropertyNotes.tsx` |
| `dashboard-summary` | *(computed client-side instead — see note below; macro itself unused but is a legitimate redundant aggregate, not a defect)* |
| `listings-in-bounds` | `MapAreaSearch.tsx` |
| `listing-photos-list/add/delete`, `listing-tour-set` | `ListingPhotoGallery.tsx` |
| `price-history-add`, `price-history` | `PriceHistoryPanel.tsx` |
| `lenders-list`, `lenders-add`, `preapproval-request`, `preapprovals-list` | `PreApprovalFlow.tsx` |
| `saved-search-check-alerts` | `SavedSearchAlerts.tsx` |
| `property-detail` | `PropertyDetailPanel.tsx` |
| `agent-lead-submit`, `leads-list`, `lead-update-status` | `ContactAgentForm.tsx` |
| `feed` | `<LensFeedButton domain="realestate" label="Live home-value feed" />` |

`dashboard-summary` has no direct caller — `RealtorShell.tsx` (a
rival-shape silhouette component, mounted only inside `ShellPreview` as a
static hub-preview, never in the live page with real data) accepts the same
shape of props but computes them independently. This is not a defect: the
macro would be a legitimate redundant path, not a dead one users rely on;
left alone.

### `real_estate.*` (10 macros) — was 100% UNSURFACED, now DESIGNED

All 10 were unreachable before this pass (see "domain-string trap" above).
Fixed by building `components/realestate/WorldPropertiesPanel.tsx` (new
file) — a real three-section buy/sell/lease workbench:

| Macro | New UI |
|---|---|
| `active_listings` | Marketplace section — live in-world listings, optional world-id filter, "yours" badge for own buildings |
| `purchase` | Marketplace section — Buy button per listing (disabled on own listings) |
| `owned` | My Buildings section — every building the player owns |
| `list_for_sale` | My Buildings — inline asking-price form per unlisted building |
| `delist` | My Buildings — Delist button (resolves `listingId` by cross-referencing `active_listings` against the building id, since `owned` only exposes `for_sale_price_cents`/`listed_at`, not the `property_listings.id`) |
| `lease` | My Buildings — inline tenant-kind/tenant-id/rent/period form per building |
| `my_rentals` (role=landlord, role=tenant) | Rentals section — two lists, "As landlord" / "As tenant" |
| `dissolve_lease` | Rentals — "End lease" button on each row, either side |
| `tick_rentals` | Rentals — "Collect due rent" button (this macro isn't on any heartbeat — see "left alone" below — so a manual trigger is the only way rent is ever actually collected today) |
| `constants` | Read once for `DEFAULT_RENTAL_PERIOD_DAYS`, used as the lease-period placeholder |

Mounted in `app/lenses/realestate/page.tsx` replacing the removed
`<LensFeaturePanel lensId="real_estate" />` generic-strip fallback (the
"Lens Features & Capabilities" collapsible section, and its now-orphaned
`showFeatures` state/`Layers` import, were removed with it).

## Secondary defect found while classifying: computed-but-invisible + field-shape-mismatched domain actions

While tracing every `handleAction` call site (the dispatcher behind
`DOMAIN_ACTIONS`), two related bugs surfaced in the *already-DESIGNED*
`capRate`/`cashFlow`/`closingTimeline`/`vacancyReport` buttons scattered
through the Transactions/Rentals/Investing tabs of the generic-artifact CRM
(the `useLensData<RealEstateArtifact>('realestate', 'artifact', ...)` store
— `Listing`/`Transaction`/`CMA`/`RentalUnit`/`Deal`/`Showing` records):

1. **Invisible results.** `handleAction` posted to
   `/api/lens/realestate/:id/run` and stored the response in
   `actionResult`, but the only place that state renders is the "Domain
   Actions Panel" gated by `showActionPanel` — a toggle set *only* by the
   header's "Actions" button. The per-card "Cap Rate"/"Cash Flow" buttons
   (Investing tab), the "Closing Timeline" button (Transactions tab), and
   the "Vacancy Report" button (Rentals tab) called `handleAction` directly
   without ever setting `showActionPanel`, so a click computed a real
   result that had nowhere to render — the exact "click returns `ok:true`
   while rendering nothing" pattern named in `CLAUDE.md`. **Fixed:**
   `handleAction` now calls `setShowActionPanel(true)` before dispatching,
   so any click surfaces its result.
2. **Field-shape mismatch (the #1 recurring bug class).** The macros read
   fixed field names off `artifact.data` — `netOperatingIncome`,
   `purchasePrice`, `rentAmount`, `monthlyExpenses`, `mortgagePayment`,
   `contractDate`, `units[]`. The persisted `RealEstateArtifact` records use
   different names for the same concepts — `noi`, `purchasePrice` (this one
   matches), `grossRent`, `operatingExpenses`, no precomputed mortgage
   payment field, `closingDate`/`date`, and (for `vacancyReport`) one
   record *per rental unit* rather than one record holding a `units[]`
   array. Every one of these buttons therefore always read `undefined` and
   produced a degenerate zeroed-out or empty result. **Fixed two ways:**
   - `handleAction` now builds a `params` object per action from the
     clicked record's real fields (`capRate`→`{noi, purchasePrice}`;
     `cashFlow`→`{monthlyRent, expenses, mortgage}` — with `mortgage`
     derived via the standard P&I amortization formula from
     `mortgageRate`/`mortgageTerm`/`downPayment`, the same math
     `calc-mortgage` uses server-side, since no field stores a precomputed
     payment; `closingTimeline`→`{contractDate}`; `vacancyReport`→`{units}`
     aggregated client-side across every `RentalUnit` artifact). Every one
     of these macros already reads `artifact.data?.x || params.x` as a
     fallback, so this required no backend change for capRate/cashFlow/
     closingTimeline.
   - `vacancyReport` (`server/domains/realestate.js`) had no `params`
     fallback for `units` at all (`artifact.data?.units || []`, full stop)
     — structurally it can't, since no single RentalUnit record ever holds
     a portfolio array. Added `|| params.units` (additive, backward
     compatible — every existing test passes `data.units` directly and is
     unaffected).

This is a UI-visibility + field-mapping fix, not new backend behavior: no
new macro was added, no existing macro's contract changed for callers that
already worked (`data.units` still works exactly as before).

## Confirmed real and already correctly wired — no changes

Grepped `Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded` across
`app/lenses/realestate/page.tsx` and all 22 `components/realestate/*.tsx` —
no fabrication signatures. Every AVM/school-rating/walk-score/
commute-estimate "seeded deterministic" value in `realestate.js` carries an
explicit `notes` field disclosing it's a placeholder pending a real API key
(Census/GreatSchools/WalkScore/Distance-Matrix) — honest-by-construction,
not silent fabrication. The 21 other components (`AISearchBar`,
`AgentMessenger`, `ContactAgentForm`, `ListingDetailDrawer`,
`ListingPhotoGallery`, `MapAreaSearch`, `OpenHouseCalendar`,
`PriceHistoryPanel`, `PropertyCompare`, `PropertyDetailPanel`,
`PropertyNotes`, `SavedSearchAlerts`, `SchoolWalkPanel`, `ToursPanel`, etc.)
were read in full and are each real, bespoke, correctly wired to their
macro.

## Left alone, with reason

- **`cma_generate`** — appears in `DOMAIN_ACTIONS` (CMA tab, "CMA Generate"
  button) but **no `cma_generate` macro exists anywhere in the backend**
  (`grep -rn "cma_generate" server/` → empty). Clicking it falls through to
  `lens.run`'s generic AI-fallback (`server.js:38317`, routes to the
  utility brain with the artifact's fields as context) — an honest degrade
  path (real AI-generated prose, not fabricated data), just generic rather
  than a dedicated, well-designed CMA engine (the platform already computes
  `similarHomes` distance-scoring inside `property-detail`, which a real
  `cma_generate` macro could reuse). **Genuinely missing, deferred** — out
  of scope for a field-mapping/wiring pass; building a new comparative
  analysis engine is new backend behavior, which this pass's brief
  restricted to "correctly wiring what already exists."
- ~~**`tick_rentals` has no heartbeat.**~~ **CLOSED (2026-07-16, `e1a7c52a`)** — new
  self-registering `real-estate-rent-collection` heartbeat (~1h cadence)
  calls the real `tickRentals` engine on a schedule; the manual "Collect
  due rent" button remains as an honest fallback. Also fixed a genuine
  pre-existing production bug found while verifying this: `real-estate.js`
  was never imported by `server/domains/index.js`, so the entire
  `real_estate` domain — including this button and every other macro in
  this file — was dead code since it shipped. Fixed with a two-line
  additive registration, verified against a real server boot.
- **`RealtorShell.tsx`** — a Zillow/Redfin rival-shape silhouette, mounted
  only inside `ShellPreview` (the standard per-lens hub-preview pattern used
  across many lenses) with representative static props, never in the live
  page with real data. This is the documented rival-shape-silhouette
  pattern from `CLAUDE.md`, not a defect.
- **`dashboard-summary`** — legitimate redundant aggregate with no direct
  caller (see classification table above); not wired to avoid a
  meaningless duplicate of client-computed header stats.

## Verification

- `node --check server/domains/realestate.js` — clean.
- `node --check server/domains/real-estate.js` — clean (untouched, checked
  per instructions since it's the domain this pass is about).
- `cd server && node --test tests/realestate-domain-parity.test.js
  tests/real-estate-engine.test.js tests/depth/realestate-behavior.test.js`
  — **74/74 pass, 0 fail** (26 suites), unmodified test files.
- `cd concord-frontend && npx eslint app/lenses/realestate/page.tsx
  components/realestate/*.tsx` — clean, no errors or warnings.
- `node scripts/verify-lens-backends.mjs` (repo root) →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — matches expected.
- `node scripts/grade-ux-polish.mjs --honest` → realestate lens:
  `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`,
  `pillarsPresent: 5`, `antiPatterns: 0`. `audit/` reverted after the run
  (`git checkout -- audit/`).
