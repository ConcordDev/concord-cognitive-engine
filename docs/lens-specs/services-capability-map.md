# Services Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("services"' server/domains/services.js` → 31
> `node scripts/lens-unsurfaced.mjs --lens services` → `0/31 macros never referenced in the frontend` (false negative for two macros — see below).

## What this lens is

Service-business management (Booksy / Vagaro / Square Appointments
territory): appointment booking, POS payments, staff shifts, client
profiles, recurring series + waitlist, and business reports (schedule
optimization, daily close, commissions, retention, inventory). Reference:
Square Appointments + Booksy for the booking/POS shape, Vagaro for the
staff/commission shape.

## State on arrival

This lens had already been through a substantial rebuild before this Wave-3
pass: `BookingSuite.tsx` (842 LOC — 7 real sub-tools, every value wired to a
per-user-persistent `services.*` macro: booking grid, self-booking, POS
payments, reminders, staff shifts, client profiles, recurring+waitlist),
`BookingActionDock.tsx` (677 LOC — per-appointment action dock + a
Square-style End-of-Day-Close modal, each action wired to a real backend:
status updates, DM send via `/api/social/dm`, receipt/invoice DTU minting,
federation publish), `RevenueRetentionPanel.tsx` and `ServicesFeed.tsx`
(real live Reddit ingestion). `services.paymentCapture` is honestly gated —
card tenders record `pay_on_site` with an explicit note when no Stripe
client-confirmation flow is wired, never a fabricated charge. No fake data,
no disconnected CRUD system. `0/31` macros unsurfaced per the script — all
31 macros are called from somewhere in the lens.

## Macro classification

All 31 macros are DESIGNED (routed through purpose-built panels, not a
generic action array):
- **Per-user persistent substrate (23)** — `bookingGrid{Create,Move,List,Cancel}`,
  `selfBook{Slots,Confirm}`, `payment{Capture,Refund,List}`,
  `reminder{Schedule,Dispatch,List}`, `shift{Create,List,Update}`,
  `staffAvailability`, `clientProfile{Upsert,List}`, `clientHistory`,
  `recurringSeries`, `waitlist{Add,List,Promote,Remove}` — all in
  `BookingSuite.tsx`, called via `lensRun('services', action, input)`
  against the real per-user in-memory store in `services.js`.
- **Business reports (8)** — `scheduleOptimize`, `reminderGenerate`,
  `revenueByProvider`, `clientRetentionReport`, `commissionCalc`,
  `dailyCloseReport`, `supplyCheck` — pure computations that read a PLURAL
  collection off `artifact.data` (e.g. `artifact.data.appointments`).
  `revenueByProvider` + `clientRetentionReport` also have a dedicated
  bespoke surface in `RevenueRetentionPanel.tsx` with editable rows.

## Defect found and fixed: field-shape mismatch on the report macros

**The bug.** `page.tsx`'s "Domain Actions" toolbar (4 buttons:
`dailyCloseReport`, `commissionCalc`, `clientRetentionReport`,
`supplyCheck`) and `BookingActionDock.tsx`'s `EndOfDayClose` (the
Square-style register-close modal) both dispatched through
`useRunArtifact('services').mutateAsync({ id, action })`, which posts to
`/api/lens/services/:id/run`. That route resolves `id` to a SINGLE stored
artifact (one Appointment / Transaction / Client / Product record) and
calls the handler as `(ctx, artifact, params)` with `artifact.data` being
that one record's fields. But every report macro reads a plural collection
— `dailyCloseReport` reads `artifact.data.appointments`, `commissionCalc`
reads `artifact.data.sales`, `clientRetentionReport` reads
`artifact.data.clients`, `supplyCheck` reads `artifact.data.materials` —
none of which exist on a single record's `data`. The handlers don't throw;
they default the missing field to `[]` and return an honestly-shaped but
hollow `{ totalAppointments: 0, totalRevenue: 0, ... }` result that reads
as a successful run over real data. Concretely: clicking **"Pull today's
close report"** in the End-of-Day-Close modal always reported $0 revenue
and 0 appointments, even with a full day of real bookings — while `step`
correctly transitioned to `'reviewing'` and rendered a populated-looking
report card. Same root cause left the "Action Result" panel for the other
3 toolbar buttons rendering **completely blank** (no matching shape block
existed for `dailyCloseReport`/`commissionCalc`/`clientRetentionReport` at
all — the panel only had render blocks for `scheduleOptimize`,
`reminderGenerate`, `revenueByProvider`, `supplyCheck`, and even
`supplyCheck`'s block silently showed "0 low stock items" for the same
reason). Two designed report macros (`scheduleOptimize`,
`reminderGenerate`) had zero buttons to trigger them at all — the
`lens-unsurfaced.mjs` script false-negatived because it substring-matches
macro names across the whole frontend tree, and both names are also real
macros in the `calendar`/`manufacturing` domains that genuinely are wired
there.

**The fix.** Both call sites now build the real collection from the
already-loaded lens data (`appointments`/`clients`/`transactions`/`products`
via `useLensData`) and dispatch through `lensRun('services', action,
{ artifact: { data: {...} } })` directly — the same `/api/lens/run`
peel-envelope pattern `RevenueRetentionPanel.tsx` already used correctly
(`server/lib/lens-input-normalize.js#peelRedundantArtifactWrapper` unwraps
the sole-key `{ artifact: { data } }` shape into both `artifact.data` and
`params`). Added the two missing buttons (Optimize Schedule, Generate
Reminders) and the three missing Action-Result render blocks
(`dailyCloseReport` by-provider breakdown, `commissionCalc`
by-salesperson breakdown, `clientRetentionReport` at-risk-client list), so
all 6 report actions now render real output instead of a blank card or a
hollow zeroed one.

Files touched: `concord-frontend/app/lenses/services/page.tsx`,
`concord-frontend/components/services/BookingActionDock.tsx`,
`concord-frontend/tests/services-lens-states.test.tsx` (the WIRING test
was pinned to the old `useRunArtifact('services')` construction at the
page's top level; updated to assert `lensRun('services', action, {...})`
is called for the report actions, preserving the original dead-wire-regression
intent under the corrected architecture).

## Reference-parity checklist (against Square Appointments / Booksy / Vagaro)

| Capability | Status | Disposition |
|---|---|---|
| Calendar/grid booking with conflict detection | ALREADY-REAL | `BookingSuite` booking grid |
| Client self-booking | ALREADY-REAL | `BookingSuite` self-book tab |
| POS payment capture (cash/card/gift card) | ALREADY-REAL, honestly gated | card = pay-on-site until a Stripe Elements/Terminal flow is wired |
| Automated reminders (SMS/email) | ALREADY-REAL | schedule + dispatch macros |
| Staff shift scheduling + availability | ALREADY-REAL | `BookingSuite` shifts tab |
| Client CRM (profile, history, rebook suggestion) | ALREADY-REAL | `BookingSuite` profiles tab |
| Recurring series + waitlist w/ auto-promote | ALREADY-REAL | `BookingSuite` recurring tab |
| Per-appointment action dock (confirm/complete/no-show/invoice/rebook) | ALREADY-REAL | `BookingActionDock` |
| Square-style end-of-day register close | FIXED THIS PASS | was silently hollow (see above); now computes over the real book |
| Business reports surfaced with real output | FIXED THIS PASS | 3 blank + 2 unwired report macros |
| Commission calculation | ALREADY-REAL (now reachable) | tiered-rate engine in `services.js`, real once fed real sales |
| Card processing (actual Stripe charge) | GENUINELY MISSING — DATA-SOURCING/ENGINEERING | needs a Stripe Elements/Terminal client-confirmation flow wired to `paymentCapture`'s existing honest-gate note; not a data-sourcing problem (Stripe is already integrated elsewhere in the codebase for retail/healthcare), so this is an ENGINEERING gap, deferred out of this pass's scope (payments infra, not this lens's UI) |

## Verification

- `npx eslint app/lenses/services/page.tsx components/services/BookingActionDock.tsx tests/services-lens-states.test.tsx` — clean, 0 errors/warnings.
- `npx vitest run tests/services-lens-states.test.tsx` — 5/5 passing (including the updated WIRING test).
- `node --test tests/services-lens-macros.test.js tests/services-domain-parity.test.js tests/services-honest-payment.test.js tests/depth/services-behavior.test.js` (server, unchanged) — 62/62 passing.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged, services already WIRED).
- `node scripts/grade-ux-polish.mjs --honest` — `services`: `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`.
- No `npx tsc --noEmit` run per standing rule (container OOM risk); manual review of the type shapes touched (mapped `AppointmentLite`/`AppointmentDataLite` objects match the pre-existing pattern already used for `tomorrowAppointments`).
