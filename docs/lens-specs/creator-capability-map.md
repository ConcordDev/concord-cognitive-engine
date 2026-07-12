# Creator Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Category leader: YouTube Studio + Buffer + Patreon (creator monetization /
content-pipeline / audience-management composite). Backend: `server/domains/creator.js`
(43 `registerLensAction("creator", ...)` calls / 42 unique macro names — reproduce:
`grep -c 'registerLensAction("creator"' server/domains/creator.js` — platforms, content pipeline,
audience, revenue, calendar, goals, revenue time-series, per-artifact performance,
audience demographics, membership tiers/subscriptions, payout ledger, scheduled
publishing, comment/community management) + REST routes registered inline in
`server/server.js` (`/api/creator/*`, `/api/marketplace/listings/*`,
`/api/marketplace/submit`, `/api/social/*`, `/api/economy/withdraw`).

## Starting state: already unusually deep

Unlike most Wave 1–2 units, this lens arrived with almost no generic-scaffold or
fabricated-data defects. `app/lenses/creator/page.tsx` (1135 LOC, 5 tabs: Overview /
Listings / Profile / Followers / Cascade) and `components/creator/CreatorStudioSection.tsx`
(a second, YouTube-Studio-shaped sub-workspace with 11 more tabs: Pipeline / Audience /
Revenue / Trends / Performance / Demographics / Membership / Payouts / Scheduled /
Comments / Calendar) between them give **every one of the 42 `creator.*` macros a
purpose-built panel** — `CrtPipelinePanel`, `CrtAudiencePanel`, `CrtRevenuePanel`,
`CrtRevenueChartPanel`, `CrtPerformancePanel`, `CrtDemographicsPanel`,
`CrtMembershipPanel`, `CrtPayoutPanel`, `CrtScheduledPanel`, `CrtCommentsPanel`,
`CrtCalendarPanel` — each a real, designed form + list (Kanban stage columns,
follower line-charts via `recharts`, tier-pricing subscription cards, a real Kanban/
inbox-shaped comment moderation surface with pin/hide/resolve/reply). No
`ManifestActionBar`/`UniversalActions`/`LensFeaturePanel` scaffold anywhere;
`grade-ux-polish.mjs --honest` already reported `tier: "polished"` before this pass.

Two macros are intentionally unsurfaced and documented in the domain file itself:
`creator.dashboard` (early shallow rollup, superseded by `GET /api/creator/dashboard`)
and `creator.royalty-summary` (superseded by the real Cascade tab / `GET
/api/creator/cascade/:dtuId`). Both explicitly call this out in code comments — not a
gap. `creator.platform-list` is also unsurfaced but genuinely redundant: the frontend
uses `creator.audience-summary` instead, which returns the same platform rows plus
follower-growth deltas the plain list doesn't compute.

## Real defects found and fixed

### 1. Listings tab was permanently unusable for every real user (the main find)

`app/lenses/creator/page.tsx`'s Listings tab (search/filter/sort, CSV export, inline
price/title/tier-price edit, withdraw, re-list — a fully-built management surface) reads
and writes `STATE.marketplaceListings`, an in-memory Map populated by exactly one
route: `POST /api/marketplace/submit` (`server/server.js:36673`). Grepped the entire
frontend (`grep -rln "marketplace/submit" concord-frontend/`) — that route is called
**nowhere** except a generic API-client wrapper that nothing invokes. Every other
"marketplace" surface in the app (`app/lenses/marketplace/page.tsx`, the DTU
`purchaseWithRoyalties` flow, the plugin marketplace, `/api/economic/marketplace/*`, the
`creative_artifacts` DB-backed system behind `personal-locker.js`) is a **separate,
unrelated listing store** — none of them ever write to `STATE.marketplaceListings`.
Net effect: `myListings` was `[]` for literally every user, forever — the entire
Listings tab (a genuinely well-built, polished CRUD surface) was pointed at a listing
type nobody could ever create through the app.

Fix: added `NewListingForm` to the Listings tab — fetches the caller's own personal
DTUs via `lensRun('dtu', 'list', { mine: true, limit: 200 })`, filters to
`scope === 'personal'` and not already actively listed (matches the exact
`personal`-scope check `POST /api/marketplace/submit` itself enforces), and lets the
creator pick one + set a price, then calls the real `/api/marketplace/submit` route.
This closes the loop end-to-end: create → appears in the list → edit/withdraw/relist/
CSV-export all now operate on real data instead of a permanently-empty state.

`concord-frontend/app/lenses/creator/page.tsx`.

### 2. Tier-pricing edit was a phantom-success bug

`ListingRow`'s edit form lets a creator toggle "Tier pricing (usage / remix /
commercial)" and set three prices; on Save it `PATCH`es
`/api/marketplace/listings/:id` with `{ title, price, tierPrices }`. The handler
(`server/server.js:47897`) destructured only `{ price, description, title }` — `tierPrices`
was silently dropped every time, while the response still returned `{ ok: true,
listing }`. A textbook instance of the "quick-tools that read/wrote backend fields
that don't exist so every click returned `ok:true`" pattern called out in `CLAUDE.md`'s
zero-demo-content section. `tierPrices` is a real field on this listing shape
(`server/routes/personal-locker.js:250` sets it at creation time on the *other*
publish path), so this was a persistence bug, not a fabricated feature — the fix adds
validated `tierPrices` handling to the PATCH handler (numeric, non-negative,
rounded to cents, mirrors the personal-locker validation shape) so edits actually
persist.

`server/server.js:47897-47921`.

### 3. (CLOSED 2026-07-12, Wave 4 gap-closure unit — see below) Listings tab pointed at a dead store with no purchase route

**Original finding (superseded, kept for history):** `tierPrices` on a
`STATE.marketplaceListings` entry was stored but never *read* anywhere — there was no
purchase route for this listing type at all. Investigation re-confirmed finding #1's
premise but found the store landscape was undercounted: Concord has **at least seven**
parallel "marketplace"/listing subsystems, not five — `STATE.marketplaceListings`
(dead), `dtu.marketplace` + `purchaseWithRoyalties` (real, constitutional 95%/5% split),
the plugin `PLUGIN_MARKETPLACE` (out of scope — different content type), `STATE.economic.listings`
(out of scope — different subsystem), the DB-backed `creative_artifacts` system used by
`personal-locker.js` (real purchase flow, but see rejection reasoning below), a
third Etsy/Bandcamp-shaped `STATE.marketplaceLens` shop/listings/orders system in
`server/domains/marketplace.js` (`listings-create`/`-publish`/`-list`, physical goods
with stock/shipping — a different product surface entirely), and a fourth, separate
DB-backed listings/publish/purchase/entitlement system in `server/durable.js` (mounted,
has its own `/api/marketplace/listings/:id` GET route that a different frontend
component, `ArtifactDetailModal.tsx`, already calls). Redirecting to any store beyond
the two genuinely money-real ones (`dtu.marketplace` and `creative_artifacts`) was ruled
out immediately as scope creep unrelated to this finding.

**Redirect-target decision.** `creative_artifacts` (`server/economy/creative-marketplace.js#publishArtifact`)
was evaluated and rejected as the target: it requires a real uploaded file (`filePath`/
`fileSize`/`fileHash`, not just a DTU record — the recipe-DTU virtual-path pattern in
`personal-locker.js`'s `list-on-marketplace` route only covers three narrow types:
`fighting_style_recipe`/`spell_recipe`/`blueprint`), a `type` from a fixed `ARTIFACT_TYPES`
catalog, a 50-char minimum description, and — for tier pricing specifically —
`license-tiers.js#validatePricing` requires *every* tier ID for that content type's full
ladder to be priced (e.g. MUSIC needs `listen`/`download`/`remix`/`commercial`/`exclusive`/
`stems` all present) and rejects unknown keys outright. The Creator lens's existing
`{usage, remix, commercial}` shape doesn't validate against ANY content type's tier
ladder — adopting `creative_artifacts` would have meant rebuilding the tab's UI, not
redirecting its data source, so it was out of scope for "redirect a UI to a real store."

**What was fixed.** The Creator lens's Listings tab (`concord-frontend/app/lenses/creator/page.tsx`)
now reads/writes the real `dtu.marketplace` + `purchaseWithRoyalties` store instead —
the one with the constitutional 95%/5% split and live buyer-facing callers elsewhere in
the app already (`components/market/PurchaseButton.tsx`, `components/music/TrackCard.tsx`,
the crafting/music lenses). Four new small macros were added in `server.js`
(`marketplace.myListings` / `updateListing` / `unlist` / `relist` — none of them touch
fee/royalty math, they only read/mutate `dtu.marketplace` metadata) because the
pre-existing `marketplace.list`/`purchaseWithRoyalties` pair only covered create+buy, not
a seller's own edit/withdraw/relist loop. While doing this, a real ownership+scope gap
was found and closed: `marketplace.list` had **no ownership check at all** — any
authenticated caller could flip any `dtuId` (including one they didn't own) into a
listing. It had been dormant (zero frontend callers) until this pass gave it a real
button; the fix mirrors the check the old (now-orphaned, kept in place) `/api/marketplace/submit`
route already enforced. `server/lib/creator-dashboard.js#computeCreatorDashboard` and
`#computeReputationLeaderboard` were also extended to read `dtu.marketplace` listings
(merged with the legacy store, not replacing it) — otherwise the Overview tab's stat
tiles and the leaderboard would have stayed frozen at the legacy store's numbers on the
exact same page where the Listings tab now shows real, live sales.

**What remains open (unchanged from before, correctly still deferred).** Tier-pricing
enforcement at purchase time is still not built — `tierPrices` is stored as
informational-only metadata on `dtu.marketplace.tierPrices` too, same non-enforcement
status as before, just relocated to a store that's actually purchasable instead of one
nobody could ever buy from. Building real enforcement needs a deliberate license-tier
design decision (which tier ids? which capabilities do they gate?) — not something to
silently default. `STATE.marketplaceListings`, `/api/marketplace/submit`,
`/api/creator/listings`, and the `/api/marketplace/listings/:id` PATCH/withdraw/relist
REST routes were deliberately left in place, unmodified, per the "don't rip out the old
one" rule — they're now genuinely orphaned (zero frontend callers), same status
`STATE.marketplaceListings` always had, just for a different reason.

## Verification

- `npx eslint server/server.js concord-frontend/app/lenses/creator/page.tsx server/lib/creator-dashboard.js server/tests/depth/marketplace-behavior.test.js server/tests/creator-dashboard-marketplace-merge.test.js` — clean (0 errors/warnings).
- `node --check server/server.js` — clean.
- `node --test server/tests/creator-domain-parity.test.js server/tests/creator-dashboard-ledger.test.js server/tests/creator-progression.test.js server/tests/dream-marketplace-bridge.test.js server/tests/creator-dashboard-marketplace-merge.test.js server/tests/depth/marketplace-behavior.test.js server/tests/consolidation-pipeline.test.js server/tests/royalty-cascade.test.js server/tests/economy/ledger-conservation.test.js server/tests/economy/withdrawal-earned-policy.test.js` — 254/254 passing (0 failures), including 11 new ownership-gate/CRUD tests for the four new macros and 8 new dashboard-merge tests.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — `creator`: `tier: "polished"`, `importsGenericTrio: false` (unchanged — this was a data-source redirect, not a visual rebuild). Reverted `audit/ux-polish-honest*.json` after the run per the transient-artifact rule.
- `cd concord-frontend && npx tsc --noEmit -p .` — 0 errors project-wide.
