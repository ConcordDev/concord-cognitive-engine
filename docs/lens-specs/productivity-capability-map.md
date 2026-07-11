# Productivity — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Category reference: Todoist / TickTick** (task model,
projects/labels, saved smart filters, karma + streaks, NL quick-add) **for
the feature set, and Linear for the interaction language** (keyboard-first
"the tool should get out of your way" — `g <key>` view chords, discoverable
via kbd chips). Judged as a standalone task manager competing head-to-head
with those apps, not merely alongside 259 siblings.

**Load-bearing finding:** the backend is a genuinely deep, persistent
Todoist/TickTick-class engine — **50 real macros** in
`server/domains/productivity.js` (`grep -c 'registerLensAction("productivity"'
server/domains/productivity.js` → 50) keyed per-user on
`globalThis._concordSTATE.productivityLens` with `saveProdState()` durability.
There is **no macro-shadowing** — `grep -n 'register("productivity"'
server/server.js` returns nothing; the domain file is the single source.
The 11 real task-manager components (`ProductivityTaskSection` + 9 panels +
`ProductivityTaskRow` + `ProductivityTaskDetail`) were already correctly
wired to that engine with correct field shapes throughout.

**The defect was entirely in `page.tsx`'s framing**: the real, deep task
manager was buried as a small top section while a **fabricated "6 office
tools" scaffold dominated the lens identity** (see below).

## Backend surface

**Macros (`server/domains/productivity.js`, 50, all real, all persistent):**

- **Legacy artifact-tasks (4)** — `taskCreate`, `projectFilter`, `focusBlock`,
  `dailySummary`. These read/write `artifact.data.tasks` (the old
  persisted-artifact design). Superseded by the 46 STATE-backed macros below;
  the only frontend that used them was the fabricated `ProductivityActionPanel`
  (now removed). Left registered for back-compat; no UI now depends on them.
- **Tasks (6)** — `task-add`, `task-list`, `task-detail`, `task-update`,
  `task-complete` (spawns the next recurrence on complete), `task-delete`.
- **Subtasks (3)** — `subtask-add`, `subtask-toggle`, `subtask-update`
  (per-subtask content/priority/dueDate/done).
- **Projects (4)** — `project-create`, `project-list` (with open-task counts),
  `project-detail`, `project-delete` (orphans tasks to no-project).
- **Labels (2)** — `label-create`, `label-list` (with per-label counts).
- **Smart views (3)** — `today-view` (overdue + due-today), `upcoming-view`
  (7-day agenda), `eisenhower-matrix` (urgent×important quadrants).
- **Habits (4)** — `habit-create`, `habit-list` (streak + doneToday),
  `habit-checkin` (toggle), `habit-delete`.
- **Focus (2)** — `focus-log` (Pomodoro session), `focus-stats`.
- **Stats (3)** — `productivity-stats` (streak + weekly/total completed),
  `karma` (Todoist-style points → Beginner…Grandmaster), `productivity-dashboard`.
- **NL quick-add (2)** — `task-parse` (parses `p1` / `#project` / `@label` /
  `today|tomorrow|in 3 days|weekday|ISO` / `5pm` / `every weekday` into a
  structured task, no LLM), `task-quick-add` (parse + persist, auto-creates
  the project).
- **Reminders (4)** — `reminder-add` (time/location), `reminder-list`,
  `reminders-due` (fires + marks), `reminder-delete`.
- **Saved filters (4)** — `filter-save`, `filter-list` (with live match
  counts), `filter-run` (by id or ad-hoc query across project/label/priority/
  due-bucket/text), `filter-delete`.
- **Calendar (3)** — `calendar-view` (month grid of scheduled tasks +
  reminders), `calendar-export-ics` (real RFC5545 VCALENDAR), `calendar-import-ics`
  (paste OR http(s) feed URL — a Google Calendar iCal "secret address" works).
- **Collaboration (5)** — `project-share` (editor/viewer), `project-collaborators`,
  `project-unshare`, `task-assign`, `task-comment-add`, `task-comments`.

`server/tests/productivity-domain-parity.test.js` → **31/31 pass, 0 fail**
(verified this pass; backend untouched).

## What was already real/wired (DESIGNED — left alone)

- **`components/productivity/ProductivityTaskSection.tsx`** — the real
  9-tab task manager. Hydrates via `productivity-dashboard`; mounts nine
  real panels. (Upgraded this pass — see below — but its wiring was already
  correct.)
- **`ProductivityTodayPanel`** — `today-view` + `upcoming-view`, real task rows.
- **`ProductivityQuickAddPanel`** — debounced `task-parse` live preview +
  `task-quick-add` persist. Best-in-class Todoist-parity NL entry.
- **`ProductivityTasksPanel`** — `task-list`/`task-add` with recurrence,
  `project-list`/`project-create`/`project-delete`, project filter chips.
- **`ProductivityTaskRow`** — shared row; `task-complete`/`task-delete`.
- **`ProductivityFiltersPanel`** — `filter-save`/`filter-list`/`filter-run`/
  `filter-delete`; ad-hoc query builder + saved-filter chips with match counts.
- **`ProductivityCalendarPanel`** — `calendar-view` month grid +
  `calendar-export-ics` (blob download) + `calendar-import-ics` (paste/URL).
- **`ProductivityRemindersPanel`** — `reminder-add`/`list`/`reminders-due`/
  `reminder-delete`, time + location kinds.
- **`ProductivityCollabPanel` + `ProductivityTaskDetail`** — `project-share`/
  `collaborators`/`unshare`, `task-assign`, `subtask-add`/`toggle`/`update`,
  `task-comment-add`/`task-comments`. Full task hierarchy.
- **`ProductivityHabitsPanel`** — `habit-create`/`list`/`checkin`/`delete`
  with flame streaks.
- **`ProductivityFocusPanel`** — `focus-log`/`focus-stats`, `eisenhower-matrix`,
  `karma`.
- **`ProductivityRepos.tsx`** — live `api.github.com` topic search for real
  open-source productivity tooling, honest error state, Save-as-DTU. Real
  data; kept as a secondary, collapsed reference section.

## The defect found + what changed

**`app/lenses/productivity/page.tsx`** framed the lens as something it is
not. Two distinct fabrication defects, both in the page (the panels were
fine):

1. **A whole fabricated "6 office tools" scaffold as the lens's primary
   identity.** The page header read *"Notebook · Spreadsheet · Diagram ·
   Mind-map · Outliner · Slides"* and the main body was a 6-tab surface of
   **hardcoded demo data referencing macros that do not exist**:
   - a `DemoGrid` with hardcoded revenue/cost numbers, captioned as backed by
     `spreadsheet.eval` (no such macro — confirmed via
     `lib/headless-probes.ts:115`, a probe that always renders "not
     registered");
   - a hardcoded `NodeTreeDemo` mind-map and a hardcoded outliner bullet list;
   - six empty placeholder slides captioned as backed by `slides.compile`
     ("plans to render" — no such macro, `headless-probes.ts:116`);
   - a Mermaid textarea whose "Render preview" just echoed the source
     (captioned as `lib/render-engine.js`, not wired);
   - an "Engine status" section rendering `DomainProbeCard`s for the two
     non-existent macros above.
   None of this touches the real `productivity.*` engine. It is a stale
   Phase-4 "universe-gap fill" scaffold that mismatched the actual backend
   (a task manager) entirely — a direct violation of the "zero demo content"
   and "zero generic tendencies" hard invariants.

2. **`components/productivity/ProductivityActionPanel.tsx` — a fabricated
   parallel task system.** An 8-button "Task workbench" whose `tasks` pool
   was ephemeral client `useState([])`: `actCreate`/`actFocus`/`actSummary`
   **never called the backend at all** (comment: "Local-first … persistence
   is via artifact create elsewhere" — it wasn't), and `actFilter` *called*
   the legacy `projectFilter` macro but then **ignored its result and
   re-filtered the local pool**. Every task vanished on reload. This
   duplicated — worse, and fake — what the real `ProductivityTaskSection`
   already does persistently. Classic defect class (c)+(d): a fabricated
   generic-CRUD system sitting beside an already-real, already-wired one.

**Fix** (frontend only; backend untouched):
- **Rewrote `page.tsx`** so the lens *is* the real Todoist/TickTick/Linear-class
  task manager. Removed the entire fabricated 6-tool scaffold (`DemoGrid`,
  `NodeTreeDemo`, the outliner/slides placeholders, the Mermaid echo, the
  `code.exec` notebook, and the `DomainProbeCard` "Engine status" probes for
  the two phantom macros). `ProductivityTaskSection` is now the primary and
  only identity.
- **Deleted `ProductivityActionPanel.tsx`** (the fabricated ephemeral
  workbench; only `page.tsx` imported it, verified via grep across
  `concord-frontend` + `server`).
- **Keyboard-first navigation (Linear parity).** Lifted tab state into the
  page and registered `useLensCommand` `g <key>` chords for all nine views
  (`g t` Today, `g a` Quick-add, `g k` Tasks, `g f` Filters, `g c` Calendar,
  `g r` Reminders, `g b` Collaborate, `g h` Habits, `g o` Focus). The chords
  are **discoverable, not just functional** — each tab renders its key as a
  `<kbd>` chip and the header shows a "press `g` then a view key" hint
  (satisfies the fluidity invariant's discoverability requirement). Active
  tab is cached via `useLensStatePersistence('productivity')` so the last
  view is restored on return.
- **Surfaced a previously-unsurfaced real macro.** `productivity-stats` (real
  completion **streak** + weekly-completed count) was never called anywhere;
  `ProductivityTaskSection` now fetches it alongside the dashboard and shows a
  Todoist-style flame streak badge in the header + a "This week" stat tile.
- Moved `ProductivityRepos` into a collapsed secondary "Discover open-source
  productivity tooling" section so its (real, honest) GitHub data never
  competes with the task manager for the lens's identity.

## Macro coverage classification

- **DESIGNED (46 of 50):** all the STATE-backed tasks/subtasks/projects/labels/
  smart-views/habits/focus/stats/quick-add/reminders/filters/calendar/collab
  macros, each surfaced by a bespoke, purpose-built panel (no button walls, no
  JSON-paste textareas). `productivity-stats` moved from UNSURFACED → DESIGNED
  this pass.
- **GENERIC-STRIP-ONLY:** none.
- **UNSURFACED (4, by design):** the 4 legacy `artifact.data.tasks` macros
  (`taskCreate`/`projectFilter`/`focusBlock`/`dailySummary`). These are the
  older artifact-based design fully superseded by the 46 STATE-backed macros;
  their only former consumer was the fabricated panel that was removed. Not a
  gap — surfacing them would re-introduce a parallel, non-persistent task
  path. `project-detail` is also not directly surfaced (project filtering uses
  `task-list?projectId`, which is the better UX) — a redundant read, not a
  missing capability.

## Genuinely missing (deferred)

| Capability | Triage class | Notes |
|---|---|---|
| Reminder **delivery** (push/desktop notification when a reminder fires) | ENGINEERING | `reminders-due` already computes fired reminders and the panel surfaces them on a manual "Check what's due now" click; a real background delivery channel (service-worker push / the existing socket bus) would close the gap to Todoist's notifications. Deferred — no fabrication in the interim (the current surface is an honest on-demand check, not a fake "notified" state). |
| Recurring-task **natural-language editing** in the detail view (Todoist's "every 2nd Monday") | ENGINEERING | The macro supports `daily/weekly/monthly/weekday/yearly/every N days`; the add form exposes these but the detail view can't yet re-parse an NL recurrence string. Small frontend build; deferred to Wave 4. |

Neither gap was faked. Both are honest, named deferrals per the sixth hard
invariant's triage requirement.

## Verification

- `node --check server/domains/productivity.js` → passes (backend untouched
  this pass; run per checklist).
- `node --test server/tests/productivity-domain-parity.test.js` → **31/31
  pass, 0 fail** (14 suites; re-verified green, unchanged).
- `cd concord-frontend && npx eslint app/lenses/productivity/page.tsx
  components/productivity/*.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — productivity reports WIRED; the two by-design NO-BACKEND-CALL
  lenses (`narrative-walk`, `ux-suite`) unchanged.
- `node scripts/grade-ux-polish.mjs --honest` → productivity entry:
  `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`,
  `pillarsPresent: 5`, `antiPatterns: 0`, `bespokeRatio: 0.923` (up from
  0.866). `audit/` reverted after the run (`git checkout -- audit/`).
- Did **not** run `npx tsc --noEmit` (shared-box memory-safety rule — the
  orchestrator runs one centralized tsc check after all lenses commit).

## Left alone, with reason

- The 11 real task-manager panels/components — untouched except
  `ProductivityTaskSection` (controlled-tab props + streak surfacing + kbd
  chips). Every macro call, field shape, and error path was cross-checked
  against `server/domains/productivity.js` during this audit and found
  correct with zero defects — the wiring reference the page was rebuilt to
  present properly.
- `server/domains/productivity.js` — no changes. All 50 macros were already
  correct with real parity-test coverage; the defect was entirely the page's
  fabricated framing, never the backend.
- The 4 legacy artifact macros — left registered (append-only back-compat),
  not surfaced (correctly superseded).
