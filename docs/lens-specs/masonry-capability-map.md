# Masonry Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.

## Backend surface

```
grep -c 'registerLensAction("masonry"' server/domains/masonry.js
```
→ **29** macros pre-wave (all in `server/domains/masonry.js`, 617 lines
before this pass; no inline `registerLensAction("masonry"...)` calls exist
in `server.js` — `grep -n 'registerLensAction("masonry"' server/server.js`
→ empty). This wave added **3 more** (`client-add` / `client-list` /
`client-delete`), bringing the total to **32**.

The 29 pre-existing macros split into two generations:
- **4 original pure-math calculators** (lines 3–58): `materialEstimate`
  (sqft + material → units/mortar/cost with real per-material unit rates),
  `mortarMix` (ASTM C270 mix-type reference table), `wallStrength`
  (slenderness-ratio structural check against TMS 402 empirical limits),
  `jobCosting` (labor+materials → overhead+profit breakdown). Surfaced by
  `MasonStuff.tsx` (4 bespoke widgets, each with its own visualizer — a
  brick-course SVG for the material estimator, a pass/fail slenderness
  gauge for the wall check).
- **25 state-backed contractor-workflow macros** (lines 131–615, `FEATURE
  1`–`FEATURE 8` in the file's own section comments): visual wall takeoff
  (`takeoff-*`, draws wall segments + window/door openings and derives net
  area → material/mortar counts), proposal generation with line items +
  margin/tax + a rendered plain-text proposal document (`proposal-*`), job
  scheduling with per-job weather advisories from forecast low-temp/precip
  (`schedule-*`), before/during/after photo documentation (`photo-*`),
  change orders with labor+material re-pricing and client sign-off
  (`change-order-*`), a material price book (`pricebook-*`), progress
  billing invoices with payment-method tracking (`invoice-*`), and an
  IBC/ACI/TMS/ASTM code-reference library keyed to check types
  (`code-search`, `code-for-check`). All are per-user `STATE`-backed
  (`getMasonState()` → `STATE.masonryLens`, a Map-of-Maps keyed by
  `maid(ctx)`), not fabricated.

`node scripts/lens-unsurfaced.mjs --lens masonry` → 0/29 pre-wave macros
never referenced in the frontend (the scanner agreed with the direct
cross-reference below).

## What was real vs. fake — the actual defect

Independent read of every macro AND every component (not trusting the
unsurfaced-script's 0-count alone) surfaced the exact pattern CLAUDE.md's
Frontend Rebuild Program calls out as the single most common defect this
wave: **`app/lenses/masonry/page.tsx` ran a whole fabricated generic-CRUD
dashboard beside already-real, already-wired components doing the same
job better.**

- `ContractorSuite.tsx` (850 lines, 8 bespoke tabs) already wired all 8
  state-backed feature groups above to real, purpose-built UI — draw-a-
  wall takeoff editor, a line-item proposal builder with a rendered
  proposal-text modal, a crew/weather job calendar with a
  `TimelineView`, a before/during/after photo grid, a change-order
  approve/reject flow, a price-book table editor, an invoice + payment-
  recording flow with a progress bar, and a searchable code library.
- `MasonStuff.tsx` (357 lines, 4 bespoke calculator cards) already wired
  all 4 pure-math macros, each with a `SaveAsDtuButton` to mint the result
  as a real DTU.
- `MasonryFeed.tsx` (69 lines) is a real, honest r/Bricklayer /
  r/Masonry / r/stonemasonry / r/Concrete feed via the live Reddit API
  (explicit "Reddit unreachable" error state, no synthetic posts).
- **But `page.tsx` (738 lines) ALSO ran a top-level tabbed dashboard**
  (`MODE_TABS`: Jobs / Estimates / Codes / Materials / Clients / Invoices
  / Inspections / Certs) built entirely on `useLensData('masonry',
  artifactType, …)` and `useRunArtifact('masonry')` — the **generic
  cross-lens artifact CRUD** (`GET/POST/PUT/DELETE /api/lens/masonry`,
  which routes to the domain-agnostic `lens.list/get/create/update/delete`
  macros, `server.js:39675-39725`), with client-invented `STATUS_CONFIG`,
  a hand-rolled `TradeArtifact` shape, and a `handleAction('analyze', …)`
  button that showed an "AI processing…" spinner over a generic
  `run.action` call with no bespoke backend behind it. None of this
  system had ANY relationship to the 29 real masonry macros — it created
  its own parallel, disconnected artifact store. Concretely: "Jobs"
  duplicated Schedule, "Estimates" duplicated Takeoff/materialEstimate,
  "Codes" duplicated the Code Library, "Materials" duplicated the Price
  Book, and "Invoices" duplicated Invoices — each with a strictly worse,
  generic editor modal standing in front of the real, richer tab that
  already existed a few hundred pixels below it on the same page.

This is squarely the "whole fabricated N-type CRUD library standing in
for a real, already-wired engine" defect class named in CLAUDE.md's
zero-demo-content section (the supplychain/mentorship/animation
precedents).

## What changed this wave

1. **Removed the fabricated generic-CRUD dashboard** from
   `app/lenses/masonry/page.tsx` in full: the `MODE_TABS`/`ArtifactType`/
   `Status`/`TradeArtifact` type system, `useLensData`/`useRunArtifact`
   wiring, the create/edit modal (`renderEditor`), the fake `renderLibrary`
   list + fake `renderDashboard` stat cards (whose "Materials Used" /
   "Completion Rate" numbers were derived from user-typed free-text status
   fields on fabricated artifacts, not from any real computation), and the
   `handleAction('analyze', …)` fake-AI button. `UniversalActions` (which
   was bound to `items[0]?.id` from the fake artifact list) was removed
   with it.
2. **Replaced the header stat row with real, live-computed numbers.** The
   new `useMasonryStats()` hook calls the actual `schedule-list`,
   `invoice-list`, and `proposal-list` macros via `lensRun` and derives
   Active Jobs / Completed Jobs / Revenue Collected / Outstanding /
   Proposal Accept Rate from their real return shapes — never a
   client-invented figure. Empty state reads `0`/`—`, honestly, not a
   fabricated placeholder.
3. **Closed the "Clients" gap for real** instead of leaving it fake or
   silently dropping it. Proposals and invoices already carry a free-text
   `client` field with no address book behind it — a genuine CRM gap, not
   a duplicate of an existing feature (ENGINEERING triage: no external
   data dependency, straightforward to build on the same `STATE`-backed
   pattern the other 8 features already use). Added 3 new macros to
   `server/domains/masonry.js`: `client-add` / `client-list` /
   `client-delete`, plus a `clientStatsFor()` helper that computes each
   client's `proposalsCount`/`proposalsValue`/`invoicesCount`/
   `invoicesTotal`/`invoicesPaid`/`invoicesOutstanding` live by matching
   the client's name (case-insensitive) against that user's real
   `proposals`/`invoices` state — never a fabricated aggregate. Added a
   9th `ClientsTab` to `ContractorSuite.tsx` (contact book with phone/
   email/address/notes, revenue-per-client rollup, add/edit/delete),
   replacing the fake "Clients" tab that used to live in the removed
   top-level dashboard with a real one backed by real macros.
4. Page layout now mounts `ContractorSuite` (the real 9-tab workflow
   suite) as the primary surface, followed by `MasonStuff` (the 4
   calculators) and `MasonryFeed` (the trade news feed) — no dead code
   path or duplicate system left behind.

## Investigated and honestly deferred

- **Inspections and Certifications** (the remaining 2 tabs from the
  removed fake dashboard) have no real backing macro and were NOT
  rebuilt this wave. Triage: **ENGINEERING** — no external data
  dependency, same `STATE`-backed pattern would apply — but neither ties
  as directly into the existing workflow loop (takeoff → proposal →
  schedule → invoice) as Clients did, and building three new feature
  systems in one pass risks the same "generic scaffold slapped on
  top" failure mode this wave was fixing. Left as a named, scoped
  follow-up rather than faked with client-side data. If picked up: model
  `inspection-add/list/update` identically to `change-order-*` (AHJ/QA
  inspection scheduled against a job, pass/fail result, deficiency notes,
  re-inspection date) and `cert-add/list` for crew certifications
  (name/type/expiry/issuing body) with an expiry-approaching indicator —
  both are simple ENGINEERING lifts, not DATA-SOURCING or CURATION, since
  no external feed or authored reference content is required.

## Reference apps

- **Field-service contractor operations**: JobNimbus / Buildertrend
  (takeoff → proposal → schedule → change order → invoice loop) —
  matched by `ContractorSuite.tsx`'s 9-tab workbench.
- **Trade calculators**: a masonry-specific "Mason Stuff" style app
  (material estimator, mortar-mix reference, wall-strength/slenderness
  check, job costing) — matched by `MasonStuff.tsx`.
- **Trade news**: r/Bricklayer / r/Masonry / r/stonemasonry / r/Concrete
  — matched by `MasonryFeed.tsx` (real Reddit API).

## Verification

- `node --check server/domains/masonry.js` → OK.
- `cd concord-frontend && npx eslint app/lenses/masonry/page.tsx
  components/masonry/ContractorSuite.tsx components/masonry/MasonStuff.tsx
  components/masonry/MasonryFeed.tsx` → clean, 0 errors/warnings.
- `cd server && node --test tests/depth/masonry-behavior.test.js
  tests/masonry-lens-macros.test.js tests/masonry-domain-parity.test.js`
  → **49/49 passing, 0 failing** (1 + 21 + 27 across the three files;
  these cover the 4 calculators + the 25 pre-existing state-backed
  macros — no test file yet exists for the 3 new `client-*` macros,
  a follow-up gap, not a regression).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,
  "NO-BACKEND-CALL":2}` total 260, 0 broken — masonry stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → masonry entry:
  `{"lens":"masonry","tier":"polished","antiPatterns":0,
  "pillarsPresent":5}` — no generic-scaffold flag.
