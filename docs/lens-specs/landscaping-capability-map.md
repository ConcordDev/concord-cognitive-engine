# Landscaping — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. Backend: `server/domains/landscaping.js`, 29 macros
registered via `registerLensAction("landscaping", ...)`, no shadowing
re-registration in `server.js`
(`grep -n 'register.*"landscaping"' server/server.js` → no `register`/
`registerLensAction` hits, only unrelated string-list mentions). Repro:
`grep -n 'registerLensAction("landscaping"' server/domains/landscaping.js | wc -l` → `29`.

## Backend surface (29 macros, all real)

**Pure-compute calculators (4)**:
- `plantSelection` — hardiness zone + sun exposure + soil type → filtered
  recommendations from a built-in 6-plant zone/sun/soil table.
- `irrigationCalc` — square footage + plant type → gallons/week (`GPM = sqft
  × in/wk × 0.623`), runtime minutes, watering frequency, monthly cost.
  Fail-closed on `Infinity`/`NaN` inputs (explicit `isFinite` guard, not a
  bare `||` fallback that lets `Infinity` leak through).
- `seasonalPlan` — hardiness zone → 4-season task calendar with the current
  season (derived from `Date`) highlighted.
- `materialEstimate` — square footage + material (mulch/gravel/topsoil/
  compost/sand) → cubic yards, bag count, cost, bulk-vs-bagged delivery note.

**External-API integrations (3)**:
- `trefle-search` / `trefle-plant` — real Trefle.io plant database lookup
  (~1M species), gated on `TREFLE_API_KEY`; returns an honest `{ok:false,
  error:"TREFLE_API_KEY env required"}` when unset, never a fabricated
  result.
- `climate-match` — Open-Meteo (free, no key) 16-day forecast → derived USDA
  hardiness zone from coldest forecast temp → zone-suitable plant list.
- `identify-plant` — routes a photo through the vision brain
  (`callVision`/`callVisionUrl`); honest `{ok:false, error:"vision
  unavailable"}` when the brain is down.
- `feed` — ingests real GBIF Backbone Taxonomy plant-species records as DTUs
  (dedup via `feedSeen` Set, no key required).

**Per-user STATE-backed substrate (18)**, all through `getLandState()` /
`saveLand()`:
- Garden beds: `bed-add`, `bed-list`, `bed-delete`.
- Plantings + care log per bed: `planting-add`, `care-log`,
  `landscaping-dashboard`.
- Visual yard layouts (2D plot canvas): `layout-create`, `layout-list`,
  `layout-delete`, `layout-save-elements`.
- Photo-overlay plant preview: `overlay-create`, `overlay-list`,
  `overlay-place`, `overlay-delete`.
- Care reminders derived from care-log cadence: `care-reminders`.
- Cost-estimate → contractor proposal (markdown export): `proposal-build`.
- Per-bed / whole-yard maintenance calendar: `maintenance-calendar`.
- Plant health diary (photo timeline per planting): `diary-add`,
  `diary-timeline`, `diary-delete`.

All 29 macros carry real behavioral/parity coverage:
`server/tests/depth/landscaping-behavior.test.js`,
`server/tests/landscaping-domain-parity.test.js`,
`server/tests/landscaping-lens-macros.test.js`,
`server/tests/landscaping-materials-domain-parity.test.js` — 63/63 pass
(`node --test` against all four files, verified before and after this pass).

## What was already real/wired

- **`components/landscaping/GardenStudio.tsx`** (1522 LOC) — DESIGNED. An
  8-tab design-studio surface (Yard Designer, Photo Preview, Identify Plant,
  Care Reminders, Climate Match, Proposal, Calendar, Health Diary), every
  value read from and written to a real macro via `lensRun("landscaping",
  ...)`. Genuine drag-drop 2D plot canvas, photo-overlay plant placement,
  camera/vision plant ID, care-log-derived reminders, live Open-Meteo
  climate matching, a line-item proposal builder with markdown export, a
  12-month maintenance calendar, and a photo health-diary timeline. No mock
  data, no generic button walls.
- **`components/landscaping/GardenBeds.tsx`** (402 LOC) — DESIGNED. Bed CRUD
  + per-bed plantings + care log, with a bar chart (`ChartKit`) of
  plantings/care per bed and a dashboard stat row, all sourced from
  `bed-list`/`bed-add`/`bed-delete`/`planting-add`/`care-log`/
  `landscaping-dashboard`.
- **`components/landscaping/PlantFinder.tsx`** (152 LOC) — DESIGNED. Real
  Trefle.io species search + detail panel (light/soil-humidity/pH/temp/
  height/growth-month cells), Save-as-DTU export of the real lookup result.
- **`components/landscaping/ProLandscape.tsx`** (326 LOC) — DESIGNED. Four
  visually distinct calculator widgets (plant selector, irrigation
  calculator, seasonal-plan calendar, bulk-material estimator), each calling
  its named `landscaping.*` macro and offering a Save-as-DTU export.

Field shapes were cross-checked directly against
`server/domains/landscaping.js` and the `{artifact:{data}}` dispatch-layer
unwrap in `server/lib/lens-input-normalize.js` (which exists precisely to
support the wrapper shape `ProLandscape.tsx`'s `callLand()` sends) — every
call site matches the macro's actual `params`/`artifact.data` reads exactly;
no field-shape mismatches found.

## The defect found + what changed

`app/lenses/landscaping/page.tsx` (750 LOC before this pass) carried a
**second, fabricated multi-tab CRUD dashboard** sitting directly beside the
four real components above — the exact "recurring defect pattern (c)" this
program's audits keep finding (matches the `plumbing` lens's defect
one-for-one; see `docs/lens-specs/plumbing-capability-map.md`):

- A `MODE_TABS` array defined 8 tabs — **Jobs, Estimates, Codes, Materials,
  CRM, Invoices, Inspections, Certs** — none of which called a
  `landscaping.*` macro. They were built entirely on
  `useLensData<TradeArtifact>('landscaping', activeArtifactType, ...)` (a
  generic `/api/lens/:domain` artifact CRUD store, unrelated to the domain's
  macro system) and `useRunArtifact('landscaping')` firing an `'analyze'`
  action that has no `landscaping.analyze` macro either — it fell through to
  the AI catch-all (`LENS_ACTIONS.get('landscaping.analyze')` is
  `undefined`, so `lens.run` routes to `utilityCall`, a real but generic LLM
  fallback, not the domain's own logic).
- **Estimates duplicated already-real, already-wired functionality.** The
  real `proposal-build` macro already models "client + project + line items
  → cost breakdown + markdown proposal" (overhead/margin/tax, a real
  contractor estimate document), fully surfaced in `GardenStudio`'s
  Proposal tab. The generic Estimates tab was a *second*, unsynced
  bookkeeping shape for the same concept (`client`/`address`/`phone`/
  `laborHours`/`laborRate`/`materialCost`/`totalCost` fields, no line
  items, no markdown export, no connection to `proposal-build` at all) — a
  user filling in the fake Estimates tab would reasonably believe they were
  building a real estimate, and it would never appear alongside a real
  proposal built through Garden Studio. This is a direct honesty problem,
  not just duplication.
- Jobs / Codes / Materials / CRM / Invoices / Inspections / Certs had **no
  backing macro of any kind** (see the GENUINELY MISSING section below) —
  the generic artifact store persisted real rows, so this wasn't fabricated
  *data* in the `Math.random()` sense, but it was a fully generic,
  non-domain-specific CRUD form standing in for a landscaping-business
  workflow that doesn't exist server-side, which independently fails the
  "zero generic tendencies" invariant.
- `<UniversalActions domain="landscaping" artifactId={items[0]?.id} compact
  />` was also mounted — CLAUDE.md names `<UniversalActions>` explicitly as
  a generic-scaffold anti-pattern component.

**Fix**: removed the entire `MODE_TABS` / `TradeArtifact` / `STATUS_CONFIG`
/ `TRADE_MATERIALS` / `TRADE_CERTS` / `useLensData` / `useRunArtifact` /
`UniversalActions` / editor-modal / library-list / dashboard-grid scaffold
(~650 LOC) from `page.tsx`. The page now has four tabs that map 1:1 onto the
four real, bespoke components: **Garden Studio**, **Garden Beds**, **Plant
Finder**, **Pro Calculators** — no parallel data system, no generic button
wall. Kept the standard cross-lens chrome (`LensShell`, `FirstRunTour`,
`ManifestActionBar`, `DepthBadge`, `LensFeedButton`, `RecentMineCard`,
`AutoActionStrip`, `CrossLensRecentsPanel` — all `hideWhenEmpty` where
applicable) since those are the platform's shared, non-lens-specific
primitives, not this defect's pattern. Added four discoverable number-key
(`1`–`4`) tab-jump commands via `useLensCommand`, each with a visible `kbd`
chip next to its tab label (the fluidity invariant: every registered
shortcut must be discoverable, not just functional) — replacing the removed
(and non-functional, since its target search box no longer exists) `/`
-focus-search binding from the old page.

Files changed: `concord-frontend/app/lenses/landscaping/page.tsx` and
`concord-frontend/tests/landscaping-lens-states.test.tsx` (the old test
mocked the removed `useLensData`/`useRunArtifact` generic-CRUD states —
loading/error/empty/populated of a fake `TradeArtifact` list — which no
longer exist; rewritten to pin the real contract: default tab, exclusive
tab-switch routing per component, kbd-chip discoverability, and keyboard
command registration on the `landscaping` lens id). No backend changes — the
29 macros were already correct.

## Investigated and honestly deferred

The 7 removed tabs beyond Estimates had no backing macro. Disposition per
capability, using the DATA-SOURCING / ENGINEERING / CURATION triage:

| Removed tab | Real capability today | Disposition |
|---|---|---|
| **Jobs** (scheduling/dispatch) | ~~No macro models a scheduled/dispatched landscaping job — the domain is design + calculation + record-keeping (beds/layouts/diary/proposals), not field-service dispatch.~~ **CLOSED (2026-07-12, `fee9def4`).** Built the job triple this row called for: `server/domains/landscaping.js` gained `job-schedule` / `job-list` / `job-complete` (this file's hyphenated macro-naming convention, mirroring plumbing's `dispatchAssign`/`dispatchBoard`/`jobComplete` shape) on the same per-user, `globalThis._concordSTATE`-backed Map pattern the rest of the domain already uses. `job-schedule` validates a required title and an optional `bedId` against real beds; `job-list` is the dispatch board — filterable by `status`/`dateFrom`/`dateTo`, grouped into per-crew lanes (+ an unassigned lane) with load-hour totals; `job-complete` stamps `completedAt`/`completionNotes` and rejects a second completion or completing a cancelled job. Scope decision: no separate crew/tech CRUD entity (plumbing's `techAdd`/`techList`) was added — `crew` is a free-text assignee string, sufficient to render real dispatch lanes without a second entity system this gap didn't ask for. New `concord-frontend/components/landscaping/JobDispatchBoard.tsx` (mirrors `FieldServiceConsole.tsx`'s dispatch-board design in this lens's existing emerald palette) is wired as a 5th "Jobs" tab in `app/lenses/landscaping/page.tsx`. Tests: 9 new cases in `server/tests/landscaping-domain-parity.test.js` (validation-rejection, bed-link validation, clamping, crew-lane grouping, status/date-range filtering, per-user scoping, double-completion + cancelled-job rejection), `job-list`/`job-schedule`/`job-complete` added to the STATE-gone degrade-graceful list in `server/tests/landscaping-lens-macros.test.js`, and 6 new cases in `concord-frontend/tests/components/JobDispatchBoard.test.tsx`. |
| **Codes** (permit/setback reference library) | No macro; the domain has no code-citation fields anywhere (unlike plumbing's calculators, which cite IPC sections). | **GENUINELY MISSING — CURATION.** Local landscaping/zoning setback and permit rules vary by jurisdiction and need a real, rights-clear reference source. Fabricating code text would be a honesty violation; deferred pending a real source. |
| **Materials** (catalog/reference, distinct from the `materialEstimate` calculator) | `materialEstimate` computes cubic-yard/bag/cost for 5 bulk materials — a real calculator, not a browsable supplier catalog (SKUs, brands, delivery lead times). | **GENUINELY MISSING — CURATION.** A real materials catalog needs sourced supplier/spec data this domain doesn't have. The calculator already covers the estimation need; deferred. |
| **CRM (Clients)** | ~~Client name is a field on `proposal-build`, but there's no persisted Client entity — a client typed once into a proposal doesn't autocomplete future proposals for the same client.~~ **CLOSED (2026-07-12, pending commit).** Built the `clientAdd`/`clientList` macro pair this row called for: `server/domains/landscaping.js` gained `client-add` / `client-list` (this file's hyphenated macro-naming convention) plus a shared `lsResolveClientRef(s, userId, params)` helper, following plumbing's `clientAdd`/`clientList`/`resolveClientRef` (`server/domains/plumbing.js`) exactly — the precedent this row named. `client-add` validates a required `name` + optional `phone`/`email`/`address`/`notes`; `client-list` supports a `query` substring filter (case-insensitive) and enriches each client with real cross-document history (`jobsCount`/`invoiceCount`/`totalBilled`) joined on `clientId` against the existing job + invoice stores. An optional `clientId` was wired additively into the three macros that already took a free-text `client` field — `proposal-build`, `invoice-from-proposal`, and `job-schedule` — resolving the saved client's name (and, for jobs, address) onto the document; omitting `clientId` preserves the original free-text behavior byte-for-byte (regression-tested). `proposal-build` only touches STATE when a `clientId` is actually supplied, so it stays pure-compute (no STATE dependency) on the free-text path exactly as before. New `concord-frontend/components/landscaping/ClientAutocomplete.tsx` (mirrors plumbing's `ClientAutocomplete.tsx` design — combobox, type-to-search, arrow-key navigate, Enter to select, inline "add as new client" when no match — restyled to this lens's emerald palette, not a literal cross-lens import) is wired into `ProposalBuilder` (`GardenStudio.tsx`), which now loads the client roster via `client-list` on mount and sends `clientId` alongside the free-text `client` on both `proposal-build` and `invoice-from-proposal` calls. Tests: 17 new cases in `server/tests/landscaping-domain-parity.test.js` (add/list round-trip, blank-name rejection, substring query filter, per-user scoping, `clientId` resolution + unknown-`clientId` rejection on all three wired macros, explicit REGRESSION cases proving the no-`clientId` path is byte-identical to the pre-change free-text behavior on `proposal-build`/`invoice-from-proposal`/`job-schedule`, a STATE-gone-but-no-`clientId` case proving `proposal-build` stays pure-compute, a STATE-gone-with-`clientId` case proving it fails soft instead of throwing, and a cross-document `jobsCount`/`invoiceCount`/`totalBilled` aggregation case), `client-add`/`client-list` added to the STATE-gone degrade-graceful list in `server/tests/landscaping-lens-macros.test.js`, and 7 new cases in `concord-frontend/tests/components/LandscapingClientAutocomplete.test.tsx` (placeholder render, substring-filtered dropdown with contact info, click-to-select, free-text edit clears the link, keyboard nav, inline create wired through `client-add`, and exact-match suppresses the "add new" option). |
| **Invoices** | ~~`proposal-build` outputs a proposal document (markdown, cost breakdown) but stops there — no "convert to invoice" / payment-tracking step (plumbing's `invoiceFromQuote` is the model to follow).~~ **CLOSED (2026-07-12, `d2e775f9`).** Built the `draft`→`sent`→`accepted`→`paid` status machine this row called for: `server/domains/landscaping.js` gained `invoice-from-proposal` / `invoice-list` / `invoice-send` / `invoice-accept` / `invoice-record-payment` (this file's hyphenated macro-naming convention, adapted from plumbing's `invoiceFromQuote`/`invoiceList`/`invoiceRecordPayment` shape — but a real 4-state machine where plumbing's invoice is 2-state, issued→partial/paid), on the same per-user, `globalThis._concordSTATE`-backed Map pattern the rest of the domain already uses. The proposal→line-item math is factored into a shared `computeProposal()` helper so both `proposal-build` and `invoice-from-proposal` derive identical totals from the same raw line items server-side — `invoice-from-proposal` re-runs the computation rather than trusting a client-supplied total, so a caller can't mint a fake invoice amount by tampering with an already-rendered proposal response. Transitions are strict: `invoice-send` only fires from `draft`, `invoice-accept` only from `sent` (you cannot skip straight from `draft`→`accepted`), and `invoice-record-payment` is rejected on both `draft` and `sent` (you cannot record payment before the client has accepted) — it supports partial payments and only flips to `paid` once `amountPaid` reaches the total. New `InvoiceTracker` component (a designed status-filterable card list with an AR summary — outstanding/collected totals + per-status counts, expandable cards showing line items/payments, and in-place status-transition + payment-recording actions) is wired as a 6th tab ("Invoices") in `GardenStudio.tsx`, reached either directly or via a new "Convert to invoice" button on the existing Proposal tab (which re-sends the same raw inputs used to build the proposal, then shows an inline confirmation with a "View in Invoices" click-through rather than silently yanking the user off the tab they were just looking at). Tests: 13 new cases in `server/tests/landscaping-domain-parity.test.js` (conversion validation-rejection, server-derived totals matching `proposal-build`'s math for identical inputs, sequential invoice numbering, list filtering + AR summary, the full happy-path walk draft→sent→accepted→paid, partial payments, every invalid-transition rejection — send-a-non-draft, accept-without-sent, pay-before-accepted on both draft and sent, zero/negative/missing payment amounts, unknown invoice ids, and per-user scoping), the 5 new macros added to the STATE-gone degrade-graceful list in `server/tests/landscaping-lens-macros.test.js`, and 8 new cases in `concord-frontend/tests/components/GardenStudioInvoices.test.tsx` (empty state, card rendering + status badges + AR summary, status filtering, the send/accept/pay transition flows including a rejected zero-amount payment, and the full proposal→invoice conversion round trip including a failure path). |
| **Inspections** | No macro, no table — nothing in the domain models a walkthrough/inspection record. | **GENUINELY MISSING — ENGINEERING.** No existing capability to build on; deferred. |
| **Certs** | `TRADE_CERTS` was a static UI dropdown with zero backing storage — not even a freeform tag field like plumbing's `techAdd.skills`. | **GENUINELY MISSING — ENGINEERING.** Deferred. |

None of these were faked to fill the gap. Estimates is substantially covered
by the real `proposal-build` macro (not deferred — it's DESIGNED, in Garden
Studio's Proposal tab); Jobs, Invoices, and CRM (Clients) are now CLOSED (see
rows above); the remaining four (Codes, Materials, Inspections, Certs) still
require new backend or curation work this pass didn't do. The removed page no
longer implies these capabilities exist when they don't.

## Verification

- `node --check server/domains/landscaping.js` → passes (backend
  untouched).
- `node --test server/tests/depth/landscaping-behavior.test.js
  server/tests/landscaping-domain-parity.test.js
  server/tests/landscaping-lens-macros.test.js
  server/tests/landscaping-materials-domain-parity.test.js` → **63/63 pass**
  (all four files, unmodified).
- `cd concord-frontend && npx vitest run tests/landscaping-lens-states.test.tsx`
  → **6/6 pass** (rewritten to match the real tab-routing contract — see
  "The defect found" above for why the old file no longer applied).
- `cd concord-frontend && npx eslint app/lenses/landscaping/page.tsx
  components/landscaping/*.tsx tests/landscaping-lens-states.test.tsx` →
  clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — landscaping reports WIRED;
  the two by-design NO-BACKEND-CALL lenses (`narrative-walk`, `ux-suite`)
  are unchanged.
- `node scripts/grade-ux-polish.mjs --honest` → landscaping entry:
  `tier: "polished"`, `isGenericScaffold: false`, `antiPatterns: 0`,
  `bespokeRatio: 0.957` (up from `0.762` before this pass — `usesGenericBody`
  flipped `true`→`false`), `pageLoc: 107` (down from `750`),
  `bespokeComponentLoc: 2402` (unchanged — the four real components were
  untouched). `audit/` reverted after the run (`git checkout -- audit/`).
- Did NOT run `npx tsc --noEmit` per the memory-safety directive for this
  pass — the orchestrating session runs one centralized typecheck after all
  lenses land.

## Left alone, with reason

- `GardenStudio.tsx`, `GardenBeds.tsx`, `PlantFinder.tsx`,
  `ProLandscape.tsx` — untouched; already DESIGNED, already wired to real
  macros, no defects found on read-through (all 29 macro call sites
  cross-checked field-by-field against `server/domains/landscaping.js`).
- `LensShell`, `LensPageShell`, `ManifestActionBar`, `DepthBadge`,
  `FirstRunTour`, `LensFeedButton`, `RecentMineCard`, `AutoActionStrip`,
  `CrossLensRecentsPanel` — kept as-is. These are the platform's shared,
  non-lens-specific chrome primitives (used across ~250+ lenses), not an
  instance of this lens's defect pattern; removing them would be unrelated
  scope creep.
- `server/domains/landscaping.js` — no changes. All 29 macros were already
  correct and already carried real test coverage before this pass.
