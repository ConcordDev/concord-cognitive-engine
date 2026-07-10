# Home Improvement Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("home-improvement"' server/domains/homeimprovement.js
```
→ **43** macros in `server/domains/homeimprovement.js` (750 lines). No
inline `register("home-improvement", ...)` in `server.js`
(`grep -c 'register("home-improvement"' server/server.js` → 0).

**Filename-mismatch trap (per the assignment brief's warning).** The domain
file is `server/domains/homeimprovement.js` (no hyphen) while the registered
domain string inside it is `"home-improvement"` (with hyphen). Running
`node scripts/lens-unsurfaced.mjs --lens home-improvement` returns **"No
registered macros found for lens home-improvement"** — a tooling false
negative, not zero macros. The macro list below was extracted by direct grep
on the correctly-identified file, then cross-referenced against every
`action:`/`lensRun(DOMAIN, '...'` call site in `app/lenses/home-improvement/`
and `components/home-improvement/*.tsx`.

## The defect: a real 8-macro project/task/expense substrate, entirely
## disconnected from the lens's PRIMARY tab

This is the most severe instance this wave of the recurring "real deep
backend sitting next to a fabricated parallel CRUD system" defect class —
severe because it wasn't a secondary feature, it was the **Projects tab**
(the lens's default/first tab) plus the **Budget tab** plus the **header
stat cards**.

`server/domains/homeimprovement.js` (read in full, lines 44-177) implements
a real per-user, STATE-backed (`STATE.homeImprovementLens.projects`, a
`Map<userId, Project[]>`) renovation-project substrate:
- `project-add` / `project-list` / `project-status` / `project-delete` —
  full CRUD. Real fields: `id, name, room (9-value enum: kitchen/bathroom/
  bedroom/living_room/basement/garage/exterior/whole_house/other), budget,
  status (planning/in_progress/on_hold/complete), notes, tasks[],
  expenses[], createdAt`.
- `task-add` / `task-toggle` — a real per-project task sub-array
  (`{id, label, done}`).
- `expense-log` — a real per-project expense sub-array
  (`{id, label, amount, kind: materials|labor|permit|tools|other, date}`),
  with `project-list` computing `spent`/`budgetRemaining` from it
  server-side.
- `home-improvement-dashboard` — real cross-project aggregate
  (`projects, activeProjects, totalBudget, totalSpent, tasks, tasksDone`).

**Before this pass**, `app/lenses/home-improvement/page.tsx`'s Projects tab,
Budget tab, and header stat cards all read from
`useLensData<ProjectData>('home-improvement', 'project', { seed: [] })` — a
generic artifact-CRUD hook with **zero backing macro** (no `project` action
of any kind is registered; the artifact type is entirely a client
invention). It diverged from the real system in every dimension:
- Different status enum (`'idea'|'planning'|'in-progress'|'completed'`,
  hyphenated) vs. the real one (`planning/in_progress/on_hold/complete`,
  underscored).
- Extra client-invented fields the real backend has no concept of:
  `category`, `priority`, `contractor`, `startDate`, `dueDate`, `materials`.
- No task sub-management UI at all.
- No `expense-log` integration — the "spent" field was a bare number typed
  once at creation, not a running ledger.
- `ProjectGantt.tsx` (the Timeline tab, read in full) was independently and
  correctly wired to the REAL `project-list`/`project-add`/`gantt`/
  `phase-*` macros the whole time — so a user could create a real project
  via the Timeline tab and it would never appear in the Projects tab (and
  vice versa: an "idea" created in the Projects tab had no phases and was
  invisible to Timeline). Two disconnected project universes on one page.

## What changed

**`app/lenses/home-improvement/page.tsx` — full data-layer rewrite of the
Projects tab, Budget tab, header stats, and planning-calculators panel.**

1. Removed `useLensData`/`useRunArtifact`/`UniversalActions` entirely (the
   generic artifact hooks with no real backing) and the fabricated
   `ProjectData` interface/`STATUS_COLORS`/`PRIORITY_COLORS`/`ROOMS`
   (mismatched casing + enum).
2. Added real types (`HiTask`, `HiExpense`, `HiProject`, `HiDashboard`)
   mirroring the backend contract exactly, and `ROOM_OPTIONS`/
   `STATUS_OPTIONS` matching the real 9-room / 4-status enums with friendly
   labels.
3. Projects tab now loads via `project-list`, creates via `project-add`
   (room/budget/notes — no more fake `priority`/`category`/`contractor`
   fields), deletes via `project-delete`. Each project card expands
   (accordion) into a real detail view: status changer wired to
   `project-status`, a task checklist wired to `task-add`/`task-toggle`, and
   an expense log wired to `expense-log` (label/amount/kind form + running
   list) — the three previously-dark macros (`task-add`, `task-toggle`,
   `expense-log`) now have real, designed UI, not a generic button.
4. Header stat cards + Budget tab now compute from the real `project-list`
   result (each project already carries server-computed `spent`/
   `budgetRemaining`/`taskCount`/`tasksDone`). Added a one-line
   `home-improvement-dashboard` surface ("X/Y tasks done across all
   projects") — a genuine, non-duplicative use of the previously-unsurfaced
   dashboard macro (it aggregates across all projects; `project-list`
   doesn't roll up task totals across the whole set).
5. Contractors tab: removed the "Contractors referenced on project cards"
   mini-list, which read the now-removed fake `p.contractor` field. The tab
   already mounts the real `ContractorDirectory` (`pro-add`/`pro-list`/
   `pro-quote-add`/`pro-review-add`) — no loss of real capability.
6. **Planning-calculators panel (`projectEstimate`/`roiCalculator`/
   `permitCheck`/`colorPalette`) — separately dead.** All four macros read
   `artifact.data` (the virtual-artifact pattern), but the UI called them
   through `useRunArtifact('home-improvement')`, which POSTs to
   `/api/lens/:domain/:id/run` and requires a **persisted** artifact id
   (`items[0]?.id`). Since the `project` artifact type never existed, this
   panel was permanently disabled behind "Create a project to run AI
   actions" — a dead button gated on a permanently-empty generic store, the
   second defect class named in the assignment brief. **Fixed:** rebuilt as
   four small real input forms (square-footage + project-type; project-type
   text; room + style; a repeatable cost/value-added row list for ROI) that
   call the macros directly through `lensRun(domain, action, params)`
   (the virtual-artifact path used throughout this wave's other fixes),
   with the existing (already-correct) result-rendering code kept as-is.

**`server/domains/homeimprovement.js` — `feed` macro enhanced (CPSC
   product-recall feed).** Was pull-only with no way to see what had been
   ingested beyond a bare `{ingested, skipped}` count (the only caller was
   the generic `<LensFeedButton>`). Added `params.op: 'list'` (returns
   persisted recall summaries with no network call) and persisted full
   summaries (`{id, recallId, product, hazard, remedy, recallDate, dtuId}`,
   capped at 200, newest-first) on every pull. **New:**
   `concord-frontend/components/home-improvement/ProductRecalls.tsx` — real
   designed panel (product/hazard/remedy/date cards + "Check for new
   recalls" button) replacing the bare `<LensFeedButton domain="home-
   improvement" label="Live product-recall feed" />`, which showed nothing
   but an ingestion count.

## Confirmed real and already correctly wired (no changes)

Read all 6 remaining components in full;
`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/home-improvement/*.tsx` → empty:
- **`ProjectGantt.tsx`** — real `project-list`/`project-add`/`gantt`/
  `phase-add`/`phase-update`/`phase-delete`, self-contained (now consistent
  with the Projects tab since both read the same real project store).
- **`ShoppingList.tsx`** — real `shopping-add`/`shopping-list`/
  `shopping-price-update`/`shopping-toggle`/`shopping-delete`.
- **`HomeInventory.tsx`** — real `inventory-add`/`inventory-list`/
  `inventory-delete`.
- **`MaintenanceReminders.tsx`** — real `maintenance-list`/
  `maintenance-seasonal`/`maintenance-add`/`maintenance-complete`/
  `maintenance-delete`.
- **`PhotoGallery.tsx`** — real `gallery-add`/`gallery-list`/
  `gallery-delete`.
- **`IdeaBoards.tsx`** — real `board-add`/`board-list`/`board-idea-add`/
  `board-idea-delete`/`board-delete`.
- **`ContractorDirectory.tsx`** — real `pro-add`/`pro-list`/
  `pro-quote-add`/`pro-review-add`/`pro-delete`.
- **`HomeImprovementFeed.tsx`** — honest external-feed panel (same pattern
  as `ProductivityFeed.tsx`), no defect.

## Verification

- `node --check server/domains/homeimprovement.js` — clean.
- `server/tests/home-improvement-domain-parity.test.js` — 21/21 pass
  unmodified (project/task/expense/gallery/board/pro/shopping/inventory/
  maintenance macros all covered; the `feed` macro's enhancement is
  additive-only — the pre-existing `op:'pull'` return shape is unchanged,
  only `op:'list'` and the persisted-`recalls` field are new).
- `npx eslint app/lenses/home-improvement/page.tsx
  components/home-improvement/ProductRecalls.tsx` — clean.

## Left alone, with reason

- **All 6 non-Projects/Budget components** (`ProjectGantt`, `ShoppingList`,
  `HomeInventory`, `MaintenanceReminders`, `PhotoGallery`, `IdeaBoards`,
  `ContractorDirectory`) — already real, already correctly wired, no
  fabrication signatures found.
