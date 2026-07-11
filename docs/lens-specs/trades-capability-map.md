# Trades lens — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. Backend: `server/domains/trades.js` (61 macros, no
shadowing re-registration in `server.js` — confirmed by
`grep -n 'register("trades"' server/server.js`, which returns nothing).

## The `trade` / `trades` directory-duplication finding (investigate-first task)

There are **two** unrelated frontend directories that collide on name but not
on concept:

- **`concord-frontend/components/trade/`** (singular — `TradeInventorySidebar.tsx`,
  `TradeWindow.tsx`) is the **player-to-player item-trading** UI for the
  Concordia world sim. It is imported exactly once, by
  `concord-frontend/components/world-lens/SocialOverlay.tsx:28`
  (`import('@/components/trade/TradeWindow')`), and talks to a completely
  different backend: `server/routes/player-trade.js`, mounted at
  `/api/player-trade`, backed by the `player_trades` table (migration
  `069_player_trade.js`) — a both-sides-confirm escrow flow (initiate → offer
  → ready → execute), mirroring the wagers.js two-party pattern. **Nothing in
  the `trades` lens (this document's subject) reaches this code path, and
  nothing in `components/trade/` reaches `server/domains/trades.js`.** It is
  not dead code — it's a live, separate feature — it's just unfortunately
  named one letter away from its neighbor.
- **`concord-frontend/components/trades/`** (plural — 19 files) is what
  `concord-frontend/app/lenses/trades/page.tsx` imports, and is the subject
  of this document: a **skilled-trades / field-service business app**
  (plumbing/electrical/HVAC/carpentry/roofing contractor software — the
  ServiceTitan/Jobber category), backed by `server/domains/trades.js`.
  `TRADES_LIST` in the page (`Plumbing, Electrical, HVAC, Carpentry,
  Roofing, Painting, Concrete, Landscaping, General`) confirms the domain:
  this is a **general-contracting + field-service dispatch** app, not a
  player-trading UI.

CLAUDE.md's "Player trade fully implemented in `server/lib/player-trade.js`"
claim is **stale on the file path** (the real file is
`server/routes/player-trade.js`, not `server/lib/`) but correct on the
substance — and, per the task's own warning, it is indeed a **separate
system** from the `trades` lens/domain. No fix needed here beyond recording
the finding; both systems are real, both are wired, they just happen to
share a near-identical directory name. (A future housekeeping pass could
rename `components/trade/` → `components/player-trade/` to kill the
naming collision permanently, but that's cosmetic, not a defect, and
touches a file owned by the World Lens rather than this lens — left alone.)

## Backend surface

Reproduce: `grep -c 'registerLensAction("trades"' server/domains/trades.js` → 61.

Two eras of macros coexist in the same file, both real, both wired:

1. **Original 7** (`calculateEstimate`, `calculatePL`, `checkPermits`,
   `generateInvoice`, `generatePO`, `scheduleInspection`, `materialsCost`) —
   operate on the generic DTU-artifact substrate (`artifact.data.*`), one
   artifact per construction **job** (with phases, change orders, material
   line items, photos — a Procore/Buildertrend-shaped project-tracking
   surface).
2. **"Full-app parity: ServiceTitan + Jobber 2026"** (54 macros) — a
   dedicated in-memory-state (`getTradesState()`/`saveTradesState()`), keyed
   per-user, covering customers, dispatch-board jobs, maintenance contracts,
   technicians, route optimization, quotes, online bookings, job photos,
   timesheets, payment links, recurring plans, reviews/NPS, a dashboard
   summary, a drag-drop weekly scheduling calendar, invoices with payment
   tracking, a customer portal, GPS technician tracking, SMS/email
   notifications, a pricebook, and a reporting dashboard.

These are genuinely two different shapes of the same "trades business"
problem (a **project-tracking** view of one big job vs. an **operational
dispatch/CRM** view of many small service calls) — not a duplicate/fabricated
system shadowing a real one. Both write to real, persisted state
(DTU artifacts for era 1; `getTradesState()`'s Map-backed, saved-on-write
per-user buckets for era 2) and both are exercised by real tests.

## What's real / already-wired

- **`app/lenses/trades/page.tsx`** (2,617 LOC) mounts the era-1 DTU/artifact
  system as six `MODE_TABS` (Jobs / Estimates / Materials / Permits /
  Equipment / Clients) with a full bespoke editor (phases, change orders,
  time entries, material entries, photo entries, estimate builder) — not a
  generic JSON-paste form.
- The era-1 "Domain Actions" row (`calculateEstimate`, `checkPermits`,
  `scheduleInspection`, `calculatePL`, `generateInvoice`) is a bespoke,
  named action strip (not a `<UniversalActions>`/`<LensFeaturePanel>` generic
  wall) with a **per-macro-shaped result renderer** — the estimate breakdown
  renders subtotal/markup/tax/grand-total tiles + line items,
  `scheduleInspection` renders inspection id/status/date/permit/stage, and
  `materialsCost` renders total/jobs-included/top-material — all reading
  real `result` fields the macros actually return. `generateInvoice` also
  chains into a real economy-side invoice DTU creation call.
  `<UniversalActions domain="trades" .../>` and `<LensFeaturePanel
  lensId="trades" />` are ALSO present (as a supplementary catch-all/roadmap
  panel, collapsed by default), but they are not the only path to any macro
  — every macro this lens registers is reachable through bespoke UI, so
  nothing here is GENERIC-STRIP-ONLY.
- **`TradesWorkbench.tsx`** (a slide-over panel, floating "Trades Workbench"
  button) is a second, real, bespoke era-2 mini-app: Dispatch (jobs,
  customer-linked, priority/status badges, live status buttons),
  Customers, Contracts — each with its own create form and list, calling
  `job-create`/`job-list`/`job-update-status`/`customer-list`/
  `customer-upsert`/`contract-list`/`contract-create`/`contract-cancel`
  with correct field shapes.
- **`ServiceTitanWorkbenchSection`** (rendered inline, not gated behind a
  toggle) mounts a 16-tab operational console — `DispatchBoardPanel`,
  `SchedulingCalendarPanel` (real drag-and-drop weekly calendar, wired to
  `schedule-week`/`schedule-set`), `TechniciansPanel`, `FieldTrackingPanel`
  (GPS + live map), `RouteOptimizerPanel`, `QuotesPanel`, `BookingsPanel`,
  `TimesheetsPanel`, `InvoicesPanel`, `PaymentsPanel`, `CustomerPortalPanel`,
  `RecurringPlansPanel`, `PricebookPanel`, `NotificationsPanel`,
  `ReviewsPanel`, `ReportingPanel` — each a real bespoke component with its
  own create/list/action calls, not a shared generic CRUD shell.
- **`DispatchShell.tsx`** (the ServiceTitan/Jobber rival-shape silhouette —
  metric strip + tech×hour dispatch grid + pending bookings/quotes rails) is
  mounted via `<ShellPreview lensId="trades" defaultOpen={true} />` at
  `page.tsx:2273`, which hydrates it from real `dashboard-summary` +
  `dispatch-board` + `bookings-list` + `quotes-list` calls — it is **not**
  orphaned (a first static grep for direct imports of `DispatchShell`
  outside `ShellPreview.tsx` looked like an orphan, but `ShellPreview.tsx`'s
  `TradesPreview()` function is the real mount site — the same pattern used
  for finance/realestate/education/logistics/agriculture/studio/aviation/
  government/environment).
- **Macro coverage: all 61 backend macros are reachable from real, bespoke
  UI** — 41 via a direct `action:`/`lensRun('trades', 'x', …)` literal
  across the panel files, the `quotes-${act}` template covering
  send/accept/reject, and the era-1 7 via the `handleAction()` bespoke
  action strip described above. No UNSURFACED macros, no
  GENERIC-STRIP-ONLY-only macros.
- No fabrication signatures anywhere in `components/trade*/`.tsx or
  `page.tsx` — `grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"`
  only matched legitimate HTML `placeholder=` attributes.

## Defects found and fixed

**Field-shape mismatches: none found** — every `lensRun` call across all 16
panel components + `TradesWorkbench.tsx` + `page.tsx`'s `handleAction` path
sends exactly the params each macro's handler reads (cross-checked every
`registerLensAction("trades", …)` body in `server/domains/trades.js` against
its caller).

**Real UX gap fixed — three "type the internal ID by hand" forms replaced
with real pickers.** `QuotesPanel.tsx`, `RecurringPlansPanel.tsx`, and
`ReviewsPanel.tsx` each had a raw `<input placeholder="Customer ID">` (or
`"Job ID"`) text field feeding `customerId`/`jobId` straight into
`quotes-create` / `recurring-plans-create` / `reviews-submit` — forcing a
user to copy-paste an opaque internal id string to create a quote, recurring
plan, or review, with no way to discover which id belongs to which customer
or job. No real field-service SaaS (Jobber, ServiceTitan, Housecall Pro)
asks a user to type a database id by hand — every one of them has a
customer/job picker. This is exactly the category-leadership +
top-notch-polish invariant: the macro was real and correctly wired
(not a defect in the reachability sense), but the surrounding UI didn't rise
to a real app's bar. Fixed:

- **`QuotesPanel.tsx`** — fetches `customer-list` alongside `quotes-list` on
  mount; the create form's Customer-ID text input is now a `<select>`
  populated with real customer names; each quote row now also displays its
  resolved customer name (previously showed only the title, with the
  customer entirely invisible in the list).
- **`RecurringPlansPanel.tsx`** — same fix: `customer-list` fetched
  alongside `recurring-plans-list`, Customer-ID input replaced with a
  `<select>` of real customers, plan rows now show the resolved customer
  name instead of a truncated raw id (`p.customerId.slice(0, 12)`).
- **`ReviewsPanel.tsx`** — fetches `job-list` alongside `reviews-list`; the
  Job-ID text input is now a `<select>` of the caller's own completed/
  invoiced jobs not yet reviewed (filtered client-side against jobs already
  present in `reviews-list`'s results, so a job can't be double-reviewed
  from the picker), and selecting a job auto-fills the customer name field
  from the job record (`job.customerName`) instead of requiring the user to
  retype it.

All three keep an honest empty-state message ("Add a customer first…" /
"No completed jobs awaiting review yet.") when the picker has nothing to
offer, rather than silently rendering an unusable blank dropdown.

`PaymentsPanel.tsx`'s `invoiceRef` field was investigated and **left as free
text on purpose** — `payments-create-link` treats `invoiceRef` as an opaque
label (a "Stripe-shape contract, no real Stripe call," per the domain file's
own comment) with no FK relationship to the `invoices-*` bucket, so there is
no real entity to pick from; making it a dropdown would fabricate a
relationship the backend doesn't enforce.

## Investigated and left alone (no gap to triage)

- **`components/trade/` (singular)** — confirmed live and wired to its own
  real backend (`server/routes/player-trade.js`); out of scope for a
  `trades`-lens rebuild pass since it's not reachable from
  `app/lenses/trades/page.tsx` at all. See the directory-duplication section
  above.
- The era-1/era-2 dual-shape design (DTU-artifact "Jobs" vs. dispatch-board
  "Dispatch") was checked for the "fabricated system shadowing a real one"
  pattern flagged as the most common defect this wave, and ruled out: both
  systems persist to real, separate, non-overlapping state and both are
  independently useful (one is a single-job project tracker with phases/
  change-orders/photos; the other is a multi-job operational dispatch/CRM
  console) — this is closer to Concord's documented "rival-shape silhouette"
  composition pattern (several concrete shapes sharing one substrate) than
  to the fabricated-duplicate anti-pattern.

## Verification

- `node --check server/domains/trades.js` — clean (file unmodified; backend
  needed no changes).
- `cd server && node --test tests/depth/trades-behavior.test.js tests/trades-domain-parity.test.js`
  → **22 suites / 53 tests passing, 0 failing** (run together; run
  individually node's single-file TAP reporter collapses
  `trades-behavior.test.js`'s internal describes into one top-level "ok 1"
  line — a node:test reporting quirk, not a real result difference; the
  combined run shows all 21 named `describe` blocks from
  `trades-behavior.test.js` passing as `ok 2`–`ok 22`, plus
  `trades-domain-parity.test.js` independently reports **52/52 passing**
  when run alone).
- `cd concord-frontend && npx eslint app/lenses/trades/page.tsx components/trade/TradeInventorySidebar.tsx components/trade/TradeWindow.tsx components/trades/*.tsx`
  → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260, 0 broken. `trades` is in the WIRED set (only `narrative-walk`
  and `ux-suite` are the by-design `NO-BACKEND-CALL` pair).
- `node scripts/grade-ux-polish.mjs --honest` → `audit/ux-polish.json` entry
  for `trades`: `"tier":"polished"`, `"antiPatterns":0`, `"pillarsPresent":5`,
  `"divAsButtons":0`, `"inlineHex":0`. `audit/` reverted after the run
  (`git checkout -- audit/`) per the program's noise-avoidance rule.

## Left alone, with reason

The bulk of the lens is left alone — 61/61 macros are already reachable
through real, bespoke, category-appropriate UI across two legitimate
"shapes" of a trades business, with no fabricated data and no generic
button-wall shadowing real work. The only gap found was the three
raw-id-text-input forms, fixed above.
