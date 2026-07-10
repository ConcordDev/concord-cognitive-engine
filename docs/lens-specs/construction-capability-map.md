# Construction Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("construction"' server/domains/construction.js` → 35

## Reference apps + parity target

- **Procore** — the incumbent general-contractor project-management
  platform. Parity target for the day-to-day field-ops side: RFIs,
  Submittals, Daily Logs, Punch Lists, Change Orders, Drawings (with
  markup + revision compare), and Budget tracking, organized as tabs in
  one shared workbench (`ProcorePanel`'s own header comment already names
  this target; `FieldManagementPanel`'s tab strip literally mirrors
  Procore's left-nav module list).
- **A lightweight estimating/scheduling toolchain (a takeoff-estimate
  spreadsheet + a CPM/Gantt tool like Microsoft Project or Buildertrend's
  scheduling module)** — parity target for the computational side:
  line-item takeoff → materials/tax/total, task-dependency CPM analysis
  with critical-path highlighting and slack, OSHA-style safety-compliance
  scoring (TRIR), and planned-vs-actual progress reporting with variance.
- **Parity target** (combined): the only difference between this lens and
  a real Procore-class GC platform should be scale (fewer projects, no
  multi-org permissions) — every RFI, submittal, log entry, punch item,
  change order, drawing revision, budget line, takeoff total, CPM slack
  value, safety rate, and progress variance should trace to a real macro
  call over real data, never a hand-typed or fabricated number.

## Capability audit — all 35 registered macros

The domain splits cleanly into two families: 4 **computational engines**
(pure functions over user-supplied structured input, no server-side
state) and 31 **field-management CRUD macros** across 7 workflows
(RFI / Submittal / Daily Log / Punch List / Change Order / Drawing /
Budget) plus one scheduling macro (`ganttSchedule`).

| Macro | Bucket | Where it's designed |
|---|---|---|
| `takeoffEstimate` (`construction.js:29`) | DESIGNED | `ProcorePanel`'s `TakeoffEstimate` widget (dynamic line-item rows: description/qty/unit/unit-cost/waste% → adjusted qty + line cost + materials/tax/total) **and** `ConstructionActionPanel`'s structured-row editor (same macro, mint/DM/publish/agent bench) |
| `criticalPath` (`:50`) | DESIGNED | `ProcorePanel`'s `CriticalPathView` (task/duration/deps rows → CPM schedule with early-start/finish, slack, critical-path highlight) **and** `ConstructionActionPanel`'s CPM editor |
| `safetyCompliance` (`:75`) | DESIGNED | `ProcorePanel`'s `SafetyCompliance` widget (checklist + incidents/workers/hours → compliance rate, OSHA-style incident rate, critical-failure list) **and** `ConstructionActionPanel`'s safety editor |
| `progressReport` (`:88`) | DESIGNED | `ProcorePanel`'s `ProgressReport` widget (per-phase planned/actual % → variance bars + overall verdict) **and** `ConstructionActionPanel`'s phase editor |
| `rfi-list` / `rfi-submit` / `rfi-respond` / `rfi-close` / `rfi-delete` (`:126-204`) | DESIGNED | `FieldManagementPanel`'s `RfiTab` — full RFI lifecycle (submit → respond → close), list + modal forms |
| `submittal-list` / `submittal-create` / `submittal-review` / `submittal-delete` (`:206-278`) | DESIGNED | `FieldManagementPanel`'s `SubmittalsTab` — create → review (approve/reject/revise) → delete |
| `dailylog-list` / `dailylog-create` / `dailylog-delete` (`:280-330`) | DESIGNED | `FieldManagementPanel`'s `DailyLogTab` — field daily-log entries |
| `punch-list` / `punch-add` / `punch-update` / `punch-delete` (`:332-399`) | DESIGNED | `FieldManagementPanel`'s `PunchTab` — punch-list items with status transitions |
| `changeorder-list` / `changeorder-create` / `changeorder-decide` / `changeorder-delete` (`:401-469`) | DESIGNED | `FieldManagementPanel`'s `ChangeOrdersTab` — create → approve/reject decision flow |
| `drawing-list` / `drawing-add` / `drawing-revise` / `drawing-markup` / `drawing-compare` / `drawing-delete` (`:471-560`) | DESIGNED | `FieldManagementPanel`'s `DrawingsTab` — add, revise (new revision), markup (annotate), compare two revisions |
| `budget-list` / `budget-add` / `budget-update` / `budget-delete` (`:562-627`) | DESIGNED | `FieldManagementPanel`'s `BudgetTab` — cost-code line items with update-in-place |
| `ganttSchedule` (`:629`) | DESIGNED | `FieldManagementPanel`'s `GanttTab` |

**Result: 0 GENERIC-STRIP-ONLY, 0 UNSURFACED.** All 35 macros already had
a real, bespoke, non-generic home before this rebuild pass.
`node scripts/lens-unsurfaced.mjs --lens construction` independently
confirms 0/35 unsurfaced.

## Three complementary layers, not duplication

The lens presents construction management at three distinct, non-
overlapping layers — worth naming explicitly since a superficial read
could mistake this for redundant CRUD:

1. **Project registry** (`app/lenses/construction/page.tsx`) — the
   generic-artifact-store layer (`useLensData('construction', ...)`,
   the same DTU-backed CRUD primitive used across many Concord lenses)
   holding *what jobs exist*: Jobs, Estimates, Materials, Inspections,
   Safety Reports, Crew Assignments, Documents (`MODE_TABS`,
   `page.tsx:125-139`), plus a dashboard rollup and a job-site map view
   (real lat/lng markers via `MapView`, `page.tsx:784-806`).
2. **Field-management workflows** (`FieldManagementPanel`, Procore-style)
   — the day-to-day GC paperwork *inside* a job: RFIs, Submittals, Daily
   Logs, Punch Lists, Change Orders, Drawings, Budget, Gantt.
3. **Computational engines** (`ProcorePanel` + `ConstructionActionPanel`)
   — takeoff estimating, CPM scheduling, OSHA safety-compliance scoring,
   and progress-variance reporting: deterministic math over structured
   input, not records to CRUD.

These three layers answer different questions (what projects exist / what
paperwork is in flight / what do the numbers say) and none of them stand
in for another — removing any one would be a real capability loss, not a
duplicate-panel cleanup.

## Verified real, not fabricated

- **No `Math.random()` or hardcoded-array-as-live-data found** in any of
  the 5 touched files (`grep -n "Math.random" app/lenses/construction/
  page.tsx components/construction/*.tsx` → no matches).
- **`OshaIncidentSearch.tsx`** hits a real external source —
  `catalog.data.gov`'s CKAN `package_search` API (federal open-data
  catalog, no key required) — for real OSHA/construction-safety datasets,
  with honest error handling (`catch` sets a real error string, never a
  fabricated result list) and a genuine Save-as-DTU capture of the actual
  search results.
- **Every `ProcorePanel`/`ConstructionActionPanel`/`FieldManagementPanel`
  mutation round-trips through `apiHelpers.lens.runDomain` /
  `lensRun` → `POST /api/lens/run` → the real `construction.*` macro** —
  confirmed by reading all four `ProcorePanel` widgets and the full
  `FieldManagementPanel` tab set; no client-computed numbers stand in for
  a macro response anywhere.
- **The project-registry "Zap" quick-action** (`page.tsx:654-662`,
  `handleAction('analyze', item.id)`) routes to the platform-wide
  `UNIVERSAL_ACTIONS` mechanism (`server.js:31965`,
  `registerUniversalLensActions()` at `:41694` — registers a real
  utility-brain-backed `analyze`/`generate`/`suggest` handler for every
  domain that doesn't define its own). This is the same generic-but-real
  AI-analysis pattern used platform-wide (not a construction-specific
  shortcut), and the artifact id it's called with is a real id from the
  same generic-artifact store the item came from — so, unlike the bug
  found in the sibling `commonsense` lens this same session (see
  `commonsense-capability-map.md`), there is no id-space mismatch here:
  `useLensData` writes and reads through the same store on both ends.

## No defects found

Unlike `commonsense` (where this session found and fixed a genuine
id-space mismatch that made three action buttons always fail), a full
trace of every construction macro's calling convention found no
equivalent defect:
- `ProcorePanel`/`ConstructionActionPanel` call macros directly via
  `apiHelpers.lens.runDomain('construction', action, { input: { artifact:
  { data } } })` (bypassing the generic per-artifact-id lookup entirely —
  the working pattern), so there is no id-mismatch class of bug possible
  in those two files.
- `FieldManagementPanel` calls macros via `lensRun('construction',
  '<macro>', { ...params })` directly with the params each macro expects
  (e.g. `rfi-submit` receives the actual form fields, not an artifact
  id) — confirmed by reading all 8 tabs' mutation call sites.
- The page-level CRUD (`page.tsx`) and the Procore-style workbench
  (`FieldManagementPanel`) never share ids or state, so there's no
  possibility of the "two disconnected stores" class of bug either — they
  are deliberately two separate, correctly-labeled data models (project
  registry vs. field paperwork), not one model accidentally split in two.

## Left alone (already real, already well-designed)

- `ProcorePanel` (`components/construction/ProcorePanel.tsx`, 393 LOC) —
  four dense computational widgets, each with dynamic add/remove rows,
  a real macro round-trip, and a Save-as-DTU capture of the actual
  result (not the input).
- `FieldManagementPanel` (1,299 LOC) — 8-tab Procore-parity workbench
  covering the full RFI → Submittal → Daily Log → Punch List → Change
  Order → Drawing → Budget → Gantt lifecycle, all list/modal-form pairs
  wired to real macros.
- `OshaIncidentSearch` (104 LOC) — real federal open-data search, not a
  construction-specific mock.
- `ConstructionActionPanel` (350 LOC) — compact power-user bench for the
  four computational engines plus mint/DM/publish/agent-insight actions;
  as of this session uses structured row editors
  (`StructuredArrayEditor`) rather than raw JSON-paste textareas for
  every input, matching the convention rolled out to sibling lenses'
  action-panel benches the same day.

## Verification

- `npx eslint app/lenses/construction/page.tsx components/construction/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors introduced (14 pre-existing errors surfaced in `app/lenses/collab/page.tsx` from a concurrent sibling agent's in-progress edit on a different lens, unrelated to construction).
- `node scripts/verify-lens-backends.mjs` — construction stays WIRED (`258 WIRED / 2 by-design NO-BACKEND-CALL`, construction not in the NO-BACKEND-CALL list).
- `node scripts/grade-ux-polish.mjs --honest` — construction: `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens construction` — `0/35 macros never referenced in the frontend`.
