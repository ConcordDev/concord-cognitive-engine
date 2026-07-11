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

### 3. (Documented, not fixed — DATA-SOURCING/ENGINEERING triage) Tier pricing has no purchase-time enforcement

Even after fix #2, `tierPrices` on a `STATE.marketplaceListings` entry is stored but
never *read* anywhere — there is no purchase route for this listing type at all (see
finding #1: nothing ever buys from `STATE.marketplaceListings`; the only consumers are
display surfaces — `/api/world/bazaar` in-world stalls and `/api/marketplace/dream-
promoted`). This is a pre-existing architectural fact, not something introduced or
fixable in this pass: Concord currently has **five parallel "marketplace" listing
stores** (`STATE.marketplaceListings`, `dtu.marketplace` + `purchaseWithRoyalties`,
the plugin `PLUGIN_MARKETPLACE`, `STATE.economic.listings`, and the DB-backed
`creative_artifacts` system), each with its own create/browse/buy surface, and only
`dtu.marketplace`/`purchaseWithRoyalties` (the one carrying the constitutional 95%/5%
royalty split documented in `CLAUDE.md`) and `creative_artifacts` (tier pricing +
royalty cascade, used by `personal-locker.js`) have real buyer-facing purchase flows.
**Triage: ENGINEERING** — wiring `STATE.marketplaceListings` into a real buy flow (or,
more likely the right fix, retiring it in favor of pointing the Creator lens's Listings
tab at the DTU royalty marketplace / `creative_artifacts`) is a defined, no-external-
dependency backend task, but it touches money flow and multiple call sites across the
app, which is out of scope for a single-lens pass and risks the constitutional fee/
royalty invariants if rushed. Flagged for a dedicated follow-up rather than fixed
silently here.

## Verification

- `npx eslint server/server.js` — clean (0 errors/warnings).
- `npx eslint concord-frontend/app/lenses/creator/page.tsx` — clean.
- `node --check server/server.js` — clean.
- `node --test server/tests/creator-domain-parity.test.js server/tests/creator-dashboard-ledger.test.js server/tests/creator-progression.test.js server/tests/dream-marketplace-bridge.test.js` — 57/57 passing (0 failures), none of the four suites touch the PATCH route directly but all pass unaffected.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged from baseline).
- `node scripts/grade-ux-polish.mjs --honest` — `creator`: `tier: "polished"`, `isGenericScaffold: false`, `importsGenericTrio: false` (unchanged — this lens was already polished; the fixes here are functional/honesty fixes, not a visual rebuild). Reverted `audit/ux-polish-honest*.json` after the run per the transient-artifact rule.
- No `npx tsc --noEmit` run per the standing no-tsc rule for this session (prior batch OOM'd the container) — the new code was reviewed manually for type correctness (the `lensRun<T>` generic call site, the `MyListing.sourceDtuId` field addition, and JSX balance were all checked by hand) in addition to the clean eslint pass.
