# Events Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("events"' server/domains/events.js
```
→ **44** macros, all `registerLensAction("events", ...)` in
`server/domains/events.js` (888 lines). No inline `registerLensAction("events"...)`
or `register("events"...)` calls exist anywhere in `server.js`
(`grep -nE 'registerLensAction\("events"' server/server.js` → empty).

**CAUTION, confirmed unrelated:** Concordia's simulated 3D-world "world
events" system (RSVP/entry-fee/DTU-generation events inside the game) is a
completely different subsystem — `server/lib/world-events.js`,
`server/tests/event-cascades.test.js`,
`server/tests/event-rsvp-world-invites-realtime-emit.test.js`,
`server/tests/event-scoping.test.js`, `server/tests/event-shapes.test.js`,
`server/tests/world-event-scheduler.test.js`. None of those files import
`server/domains/events.js` (`grep -l "domains/events" server/tests/*.js` →
only `events-domain-parity.test.js` and `events-planning-domain-parity.test.js`).
This lens (`events`) is the standalone event-management-SaaS domain
(Eventbrite/Cvent/tour-production parity); the game's world-event scheduler
was left untouched.

The 44 macros split into two generations, by file section:

- **4 legacy "creative-tools" concert/tour macros** (lines 2-57,
  `registerLensAction` reading from `artifact.data`): `budgetReconcile`
  (projected budget vs. expense/revenue lines → variance + category
  breakdown), `advanceSheet` (venue + schedule + production + hospitality →
  a formatted tour advance sheet), `techRiderMatch` (rider requirements vs.
  venue-equipment-on-hand → fulfillment %), `settlementCalc` (guarantee vs.
  door-split → the higher settlement + method). These are one-shot
  calculators — no `eventId`, no STATE lookup, they just fold whatever
  `artifact.data` (== the caller's `input`, since `/api/lens/run` builds a
  virtual artifact whose `.data` **is** `input`) they're given.
- **40 STATE-backed event-planning macros** (lines 59-888, comment: "the
  ticketing, public page, seating, budget builder, agenda, check-in, and
  blast macros added to reach Eventbrite/Cvent feature parity"), all keyed
  by `eventId` into a per-user `STATE.eventsLens.events` Map:
  - **Core event CRUD (6)** — `event-create`, `event-list`, `event-detail`,
    `event-update`, `event-delete`, `events-dashboard`.
  - **Tasks + vendors (5)** — `task-add`, `task-toggle`, `task-delete`,
    `vendor-add`, `vendor-remove`.
  - **Feature 1 — Ticketing (7)** — `tier-create`, `tier-list`,
    `tier-update`, `tier-delete`, `register-attendee`, `registration-list`,
    `registration-cancel`.
  - **Feature 2 — Public event page (2)** — `publish-page`, `public-page`.
  - **Feature 3 — Seating / floor plan (6)** — `table-add`, `table-move`,
    `table-remove`, `seat-assign`, `seat-unassign`, `floor-plan`.
  - **Feature 4 — Budget builder (4)** — `budget-line-add`,
    `budget-line-update`, `budget-line-delete`, `budget-summary`.
  - **Feature 5 — Run-of-show / agenda (4)** — `agenda-item-add`,
    `agenda-item-update`, `agenda-item-delete`, `agenda-timeline`.
  - **Feature 6 — Check-in / QR scanning (3)** — `check-in`,
    `check-in-undo`, `check-in-status`.
  - **Feature 7 — Email/SMS blasts (3)** — `blast-send`, `blast-list`,
    `blast-delete`.

`node scripts/lens-unsurfaced.mjs --lens events` (before this pass) →
`1/44 macros never referenced in the frontend` (`tier-update`). That number
was necessary but **not sufficient**: `techRiderMatch` and `settlementCalc`
were counted "surfaced" only because their names appeared as a static string
in `concord-frontend/lib/lenses/manifest.ts`'s `actions: [...]` declaration —
metadata, not a call site — and `budgetReconcile`/`advanceSheet` were called,
but through a mechanism that always fed them the wrong data shape (below).
This is the same class of false-positive the `eco` audit flagged for the
unsurfaced script.

## Reference apps

- **Ticketing + public RSVP page + check-in**: Eventbrite / Luma (tiered
  ticket sales, a shareable public event page, a door check-in scanner).
- **Seating + floor plan**: Cvent / Social Tables (drag-to-place tables,
  per-guest seat assignment, capacity tracking).
- **Budget + attendee CRM + blasts**: Cvent (line-item budget vs. actual,
  segment-targeted email blasts to registrants).
- **Tour/production advance**: Prism.fm / a tour manager's advance-sheet
  workflow (venue advance, tech rider fulfillment against house gear,
  guarantee-vs-door-split settlement) — this is a different reference
  category from Eventbrite (touring production ops, not consumer ticketing),
  which is why it's scoped as its own "Production" surface below rather than
  folded into ticketing.

## Classification (before this pass)

**The richest gap of the audited set: a fully real, comprehensive
Eventbrite/Cvent-parity engine existed and was reachable, but was presented
as an unlabeled afterthought below an entirely separate, parallel, generic
CRUD scaffold that occupied the whole primary tab surface — plus 5 concrete
dead/garbage-output action buttons scattered through that scaffold.**
Specifically, three files:

1. **`components/events/EventOps.tsx` (1,123 lines, pre-existing) and
   `components/events/EventPlanner.tsx` (212 lines, pre-existing) — both
   real, both clean, together covering 39 of the 40 STATE-backed macros.**
   Verified by reading every line and matching every `lensRun('events', ...)`
   call against the macro grep above (`grep -n "\"$m\"" components/events/*.tsx`
   for each of the 44 action names). `EventOps` is a tabbed console
   (Ticketing/Attendees/Floor Plan/Budget/Run of Show/Check-in/Blasts/Public
   Page) that creates a real STATE event, then round-trips every one of the
   40 macros with matching forms, tables, and a `ChartKit`/`TimelineView`
   visualization per tab. `EventPlanner` is a second, more compact console
   covering event CRUD + planning tasks + vendors + the dashboard. Neither
   file had any fabrication signature (`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" components/events/EventOps.tsx components/events/EventPlanner.tsx`
   → 1 hit, and it's legitimate: `Math.random()` used to seed a new floor
   table's initial `(x, y)` scatter position, not fabricated data). The one
   real gap: **no tier-edit UI** — `addTier`/`delTier` existed but no call to
   `tier-update`, so a ticket tier's price/quantity/perks could never be
   changed after creation without deleting and recreating it (losing sold
   count). This matches the unsurfaced-script finding exactly.
2. **`app/lenses/events/page.tsx` (2,919 lines) — a real, backend-persisted,
   but entirely separate generic DTU-artifact CRUD system occupies the whole
   primary 8-tab surface (Dashboard/Events/Venues/Vendors/Guests/Run of
   Show/Budget/Tickets), built on `useLensData('events', 'Event' |
   'Venue' | 'Vendor' | 'Guest' | 'RunOfShow' | 'Budget' | 'TicketTier', ...)`.**
   This is not fabricated data — `useLensData` is a real, generic,
   backend-persisted DTU-artifact hook used across many lenses as a
   lightweight typed-form CRUD primitive — but it is a **structurally
   generic, disconnected duplicate** of the real production engine: a
   separate "Event" concept with its own id space and its own field set
   (`eventType`, `ticketPrice`, `capacity`, `attendees[]`, ad hoc `revenue`)
   that never touches `STATE.eventsLens` and can never see a ticket tier,
   a seating chart, a check-in, or a blast created in `EventOps`. `EventOps`
   and `EventPlanner` were mounted, but only as two unconditional `<section>`
   blocks appended **after** the tab system and the collapsible "Lens
   Features" panel — no tab, no label, no discoverability; a user landing on
   the page sees only the generic scaffold unless they scroll past
   everything else. A full unification of the two systems (rewriting the
   8-tab CRUD surface to read/write through `STATE.eventsLens` instead of
   generic DTU artifacts) is a much larger architectural project than a
   single-lens surgical pass — documented here as a genuine, named residual
   rather than silently left alone (see "What changed" for the surgical fix
   that was in scope).
3. **Five dead/garbage-output action-button sites inside that generic
   scaffold, at 4 locations in `page.tsx`** — confirmed by reading each
   site and tracing `useRunArtifact('events')` → `POST /api/lens/events/:id/run`
   → `server.js:39709` → `runMacro("lens","run",{id,...body})` → the real
   `events.js` handler is invoked with `artifact` = the fetched **generic**
   DTU row (fields like `eventType`/`ticketPrice`/`capacity`, never
   `budget`/`expenses`/`revenue` or `venue.stageSize`/`loadIn`/`hospitality`):
   - Dashboard "Domain Actions" strip (5 buttons) and the identical strip
     repeated inside the Event-detail "Actions" panel: `Budget Analysis`
     (`budgetReconcile` — real macro, wrong shape, always returns
     `projectedBudget: 0, totalExpenses: 0, ...` regardless of the actual
     event's numbers), `Vendor Check` (`vendor_check` — **not a registered
     macro at all**, fails every click with `{ok:false, error:"unknown_macro"}`
     per the `server.js` fail-fast dispatcher), `Run-of-Show Generate`
     (`ros_generate` — **not registered**, same failure), `Registration
     Report` (`registration_report` — **not registered**, same failure),
     `Event Summary` (`advanceSheet` — real macro, wrong shape, every field
     renders `"TBD"`).
   - Run-of-Show tab: `AI Generate Segments` (`ros_generate` — not
     registered) and `Export` (`advanceSheet` — wrong shape).
   - Budget tab: `AI Budget Analysis` (`budgetReconcile` — wrong shape).
   - A raw `<pre>{JSON.stringify(actionResult, null, 2)}</pre>` dump
     rendered whatever (frequently an error message) these calls produced.
   This is the exact "dead-wired button" class CLAUDE.md names: a click that
   fires a real macro name but can never produce a meaningful result because
   it's structurally wired to the wrong id-space and data shape, plus three
   buttons calling macros that were never real to begin with.
4. **`lib/lenses/manifest.ts`'s `events` entry declared metadata that
   doesn't match the backend**, consumed live by `components/chat/ToolPalette.tsx`
   (the agent/user command palette — `buildCatalog()` turns every
   `manifest.actions` entry into an invokable `lensRun(domain, action, {})`
   tool) and by `EmptyStateCTA.tsx`/`LensVerticalHero.tsx` (`manifest.artifacts[0]`):
   - `actions: [...'ticketForecast', 'vendorCompare', 'runOfShow', 'postEventReport']`
     — **four of the eight declared actions are not registered macros at
     all** (confirmed against the 44-macro grep above); every command-palette
     invocation of them would fail with `unknown_macro`, exposed directly to
     users/agents.
   - `artifacts: ['Event', 'Venue', 'Performer', 'Tour', 'Production', 'Vendor', 'SettlementRecord']`
     — four of the seven (`Performer`, `Tour`, `Production`,
     `SettlementRecord`) don't exist anywhere in the actual generic CRUD
     `ArtifactType` union in `page.tsx`, and the four real trailing types
     (`Guest`, `RunOfShow`, `Budget`, `TicketTier`) were missing.
   - `firstRunGuide.steps[2].caption` referenced `postEventReport` (not real).
   This mirrors a pattern two sibling Wave-3 audits found independently in
   the same file this session (`ethics`, `engineering` — see their
   capability maps / the `manifest.ts` diff): a manifest `actions` array is
   easy to hand-author as an aspirational feature list and easy to leave
   stale once the real macro names diverge, and it has a *live* consumer
   (`ToolPalette`), not just documentation weight.

## What changed

- **`server/domains/events.js` — untouched.** No backend gap; the 44 macros
  were already real, all four "genuinely homeless" ones already had adequate
  behavioral coverage or got a new one (below).
- **`concord-frontend/components/events/EventOps.tsx`:**
  - **`tier-update` given a real home.** Each ticket-tier card now has an
    `Edit` button that reveals inline price/quantity/perks inputs (matching
    the file's existing inline-edit idiom used for budget-line `actual` and
    agenda `durationMin`) and a `Save`/`Cancel` pair that calls
    `tier-update` and reloads the ticketing tab. No more delete-and-recreate
    to fix a typo'd price.
  - **New "Production" tab — the real home for the 4 orphaned legacy
    macros**, styled as a tour-advance workbench distinct from the
    ticketing/budget tabs it sits next to:
    - *Advance Sheet* — a real form for venue (name/address/capacity/
      contact/stage/sound/lighting/backline), schedule (date/load-in/
      soundcheck/doors/show time/curfew), and hospitality
      (catering/green room/parking) → calls `advanceSheet`, renders the
      computed sheet.
    - *Tech Rider Match* — two chip-list builders (rider requirements with
      quantities; venue equipment on hand) → calls `techRiderMatch`, renders
      the fulfillment table + fulfilled/total/rate stats.
    - *Settlement Calculator* — guarantee, door-split %, tickets sold,
      average ticket price → calls `settlementCalc`, renders gross door /
      artist share / settlement / method. Ticket-sold and ticket-price
      fields **default from the event's own live tier totals**
      (`tierTotals.totalSold` / `totalRevenue / totalSold`, already loaded
      for the Ticketing tab) when left blank — a genuine cross-tab
      integration, not a decorative placeholder.
    - *Quick Budget Reconcile* — a projected-budget field plus add/remove
      expense and revenue line builders → calls `budgetReconcile`, renders
      totals/net/variance. Labeled explicitly as a fast one-shot estimate,
      distinct from the persistent line-item ledger in the Budget tab, so
      the two don't read as confusing duplicates.
  - New icon imports: `FileText, Music2, Scale, Calculator, Pencil, Save`
    (all used; verified with `grep -c '\b<Icon>\b'`).
- **`concord-frontend/app/lenses/events/page.tsx`:**
  - Removed `useRunArtifact`, the `runAction`/`handleAction`/`actionResult`
    plumbing, and all 4 dead/garbage-output action-button sites (Dashboard
    strip, Event-detail strip, Run-of-Show tab, Budget tab) — these were
    unfixable in place without unifying the two id-spaces (a larger project,
    named above as a residual), so per the honest-by-construction rule
    (remove, don't leave a fake/broken action standing) they were replaced
    with an honest navigation affordance: a "jump to the real Event
    Operations console" card/button (`jumpToEventOps`, a `scrollIntoView`
    anchor to a new `id="event-operations"` on the `EventOps` section —
    an honest same-page scroll, not a fabricated per-item deep link, since
    the two systems don't share an id-space).
  - Removed the raw `JSON.stringify(actionResult)` debug dump block.
  - Removed the now-unused `Play` icon import, added `ArrowDown` (used by
    the new nav cards).
- **`concord-frontend/lib/lenses/manifest.ts`** (events entry only — other
  entries in the diff are sibling Wave-3 agents' concurrent edits to other
  lenses in the same file, confirmed non-overlapping):
  - `actions` now lists 8 **real** macro names spanning every family:
    `event-create`, `tier-create`, `register-attendee`, `check-in`,
    `blast-send`, `advanceSheet`, `techRiderMatch`, `settlementCalc`.
  - `artifacts` now lists the 7 real generic `ArtifactType`s
    (`Event`/`Venue`/`Vendor`/`Guest`/`RunOfShow`/`Budget`/`TicketTier`)
    instead of 4 fictional ones.
  - `firstRunGuide.steps[2]` rewritten to reference real macros
    (`check-in` + `blast-send`) instead of the nonexistent `postEventReport`.
- **`server/tests/events-planning-domain-parity.test.js`** — added a
  `callWithData` helper (passes the input as `artifact.data`, matching how
  `/api/lens/run` actually builds the virtual artifact for these four
  `artifact.data`-reading legacy macros — the file's existing `call()`
  helper always passes an empty `data: {}`, which can't exercise them) and
  5 new tests pinning the exact contract the new Production tab now depends
  on: `advanceSheet` field folding, `techRiderMatch` fulfillment counting,
  `settlementCalc`'s door-split-vs-guarantee branch in both directions, and
  `budgetReconcile`'s variance/category-breakdown math.

## Verification

- `cd concord-frontend && npx eslint app/lenses/events/page.tsx components/events/EventOps.tsx lib/lenses/manifest.ts` — clean, exit 0.
- `node scripts/lens-unsurfaced.mjs --lens events` — now `0/44 macros never
  referenced in the frontend` (was `1/44`, `tier-update`).
- `cd server && node --test tests/events-domain-parity.test.js tests/events-planning-domain-parity.test.js`
  — **37/37 passing** (32 pre-existing + 5 new), 0 failures.
- `cd concord-frontend && npx vitest run tests/lib/lenses/manifest.test.ts` —
  24/24 passing (confirms the `manifest.ts` edit didn't break the manifest
  shape/index contract).
- Manual type read-through in place of a full-project `tsc` (avoided here
  per the task's instructions — sibling agents were concurrently editing
  `engineering`/`entity`/`environment`/`ethics`/`experience`/`expert-mode` in
  the same working tree, confirmed via `git status` during this session):
  the new `AdvanceSheetResult`/`RiderMatchResult`/`SettlementResult`/
  `ReconcileResult` interfaces in `EventOps.tsx` are structurally matched to
  the exact object shapes the four macros return (cross-checked against
  `server/domains/events.js` line-by-line, and now pinned by the 5 new
  backend tests); every `run(...)` call result is cast with a single `as
  <Interface>` following the file's own pre-existing pattern (e.g.
  `(r?.tiers as Tier[])`); optional/possibly-undefined venue/hospitality
  sub-object fields are only read after the `advanceSheetResult &&` guard,
  so no field access can run against `null`.
- Fabrication re-grep after the edit:
  `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/events/page.tsx components/events/EventOps.tsx`
  → 1 hit, the pre-existing legitimate `Math.random()` floor-table scatter
  seed (unchanged by this pass).
- Did not touch `server/domains/events.js`, `EventPlanner.tsx`, or
  `NasaEarthEvents.tsx` (all three confirmed real and already correctly
  wired; NasaEarthEvents is a live NASA EONET disaster-feed panel, unrelated
  to the 44 macros, left as-is).
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.

## Named residual (not fixed in this pass — documented, not hidden)

The top-level 8-tab generic DTU-artifact CRUD system in `page.tsx`
(Dashboard/Events/Venues/Vendors/Guests/Run of Show/Budget/Tickets) is real
and backend-persisted, but remains a structurally generic, disconnected
duplicate of the STATE-backed production engine now properly surfaced below
it. Unifying the two (routing the primary tab surface through
`STATE.eventsLens` instead of generic DTU artifacts, or demoting the generic
CRUD to a lightweight "quick notes before you build the real event" front
door) is a full information-architecture rewrite of a ~2,900-line page — out
of scope for a single-lens surgical pass. What *was* in scope and got fixed:
every button that fired a macro against the wrong data (dead/garbage-output)
or a macro that didn't exist (dead) was removed and replaced with an honest
navigation link to the real system, so nothing on the page can silently
"succeed" with fabricated or empty-default output anymore — but the two
systems still don't share data, and a future pass should treat that as the
next real gap for this lens.
