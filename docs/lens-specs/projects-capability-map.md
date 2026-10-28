# Projects Lens — Capability Map (Frontend Rebuild Program, Wave 2, batch 7)

> **Re-verification (HANDOFF-3 batch L12, 2026-10-28, against main 02910bbb):**
> The rebuild audit below is kept as history. Current truth:
>
> - **93/99 macros named in the frontend** (fresh scan). The 6
>   unnamed all carry dispositions: `ganttGenerate`/`riskMatrix`/
>   `burndownCalc` — three of the four legacy generic-artifact macros
>   this map left unwired by design (their jobs are done better by
>   the real per-project panels; the fourth, `stakeholderMap`, is
>   named in the frontend today); `attachment-list`/`relation-list`
>   — superseded by the composite `task-detail` macro, which returns
>   both in one call; `sync-since` — an incremental-sync API
>   primitive (tasks changed since a timestamp, server-tested),
>   an integration surface rather than a missing UI feature.
> - The three "deferred low-priority" items from the audit below
>   (`view-run`, `integration-link`, `label-update`) are all named
>   in the frontend today — wired or referenced since; the WIP-limit
>   editing this rebuild added (`wip-set`) is intact.
> - **Shipped in this batch:** the concept's serif headline —
>   "What's in flight, {username}" — as the page header
>   (`data-testid="projects-greeting"`, `tests/projects-greeting.test.tsx`).
> - Server suites run locally this pass: projects-domain-parity
>   passes (in the combined 82-pass L12 run).


Reproduce the macro list:
`grep -c 'registerLensAction("projects"' server/domains/projects.js` → 98 macros
(plus 4 legacy generic-artifact macros — `ganttGenerate`, `riskMatrix`,
`burndownCalc`, `stakeholderMap` — pre-dating the real per-entity model, see
below). This is the largest single-domain macro surface touched this batch:
project CRUD/portfolio/dashboard, full issue tracking (tasks, sub-issues,
dependencies, custom fields, labels, attachments incl. binary upload/download,
threaded comments, activity log), sprints + burndown, milestones, risk
register, goals, Kanban board + WIP limits + swimlanes, saved views,
automation rules, task templates, bulk operations, velocity/flow/cycle-time/
forecast reports, team + presence, triage queue, SLA policies + escalation,
third-party integrations, notifications, and a command-search index.

## Reference apps

- **Linear** — issue tracking, cycles/sprints, triage, saved views, keyboard-first workflow.
- **Asana** — portfolios, goals, timeline/Gantt, custom fields.
- **Jira** — Kanban boards with WIP limits and swimlanes, automation rules, backlog grooming.

## Audit finding: the lens was already substantially rebuilt; the legacy scaffold sat unremoved alongside it

`components/projects/ProjectsSection.tsx` + ten `Pj*` panel components
(`PjBoardPanel`, `PjBacklogPanel`, `PjTimelinePanel`, `PjSprintsPanel`,
`PjReportsPanel`, `PjPlanningPanel`, `PjTeamPanel`, `PjCollabPanel`,
`PjSettingsPanel`, `PjPortfolioPanel`, `PjTaskDetail`) are a real,
comprehensive, already-shipped Linear/Asana/Jira-parity project-management
product — ~2,900 LOC, every panel wired directly to a real `projects.*` macro
via `lensRun('projects', …)` with a literal domain string. Cross-checking every
macro against every `lensRun` call site in `components/projects/` shows **89 of
98** real per-entity macros already reachable through a designed panel
(board with Kanban + swimlanes, backlog, sprints + burndown chart, milestones/
risk-register/goals, velocity/cumulative-flow/cycle-time/forecast charts via
`recharts`, team + custom fields + labels + automation rules + task templates,
a full issue-detail modal with sub-issues/dependencies/attachments incl. real
binary upload-download/threaded comments/activity log, triage queue, SLA
policies, integrations, notifications, portfolio). None of that needed
rebuilding — it already IS the reference-app-quality feature this program is
aiming for.

What was genuinely wrong: `app/lenses/projects/page.tsx` mounted the real
`ProjectsSection` *and*, alongside it, an entire **second, legacy generic-CRUD
project-management UI** that pre-dates it:

1. A `MODE_TABS` array (Projects/Tasks/Milestones/Resources/Timeline/Risks/
   Budget) backed by `useLensData('projects', activeArtifactType, { seed: [] })`
   — a generic per-domain artifact store, completely disconnected from the
   real `project-create`/`task-create`/`milestone-create`/etc. macros
   `ProjectsSection` uses. Its own create/edit modal, its own dashboard toggle,
   its own stats row — a full parallel "board" that never touched a real
   project, task, or sprint.
2. A "Project Analysis Engine" panel running `ganttGenerate`/`riskMatrix`/
   `burndownCalc`/`stakeholderMap` against `items[0]?.id` (the first item of
   that same disconnected generic store). These four macros are a **legacy,
   single-generic-artifact-shaped** predecessor to the real model: they expect
   `artifact.data.{tasks|risks|totalPoints,dailyCompleted|stakeholders}` on
   one ad-hoc record, not the real per-entity `projects`/`tasks`/`sprints`/
   `risks` tables the rest of the domain (and `ProjectsSection`) uses. Every
   click against the generic store's actual (unrelated) `.data` shape
   degraded to each macro's own "add tasks/risks/stakeholders" default
   message — never a real result for a real project.
3. `<UniversalActions>`, a duplicate stats row, and a `<LensFeaturePanel>`
   "Lens Features & Capabilities" toggle — all redundant given the real,
   bespoke `ProjectsSection` mounted right above them.

## What this rebuild changed

- **Removed** from `app/lenses/projects/page.tsx`: the entire `MODE_TABS`/
  `useLensData`/`useRunArtifact` legacy board (create/edit modal, its own
  dashboard, its own filtered list rendering), the "Project Analysis Engine"
  panel (`ganttGenerate`/`riskMatrix`/`burndownCalc`/`stakeholderMap` against
  the disconnected generic artifact), `<UniversalActions>`, the duplicate
  stats row, and the `<LensFeaturePanel>` toggle. The page is now: header
  (with the real `LiveIndicator`/`DTUExportButton`) → `RealtimeDataPanel` →
  the real `ProjectsSection` → the real `ProjectMgmtRepos` GitHub feed → the
  standard sentinel row. The four legacy generic-artifact macros
  (`ganttGenerate`/`riskMatrix`/`burndownCalc`/`stakeholderMap`) are left
  unwired by design — every one of their use cases (task timeline, risk
  register + scoring, sprint burndown, stakeholder communication planning) is
  already covered, better, by the real per-project `PjBoardPanel`/
  `PjPlanningPanel`/`PjReportsPanel`/`PjSprintsPanel` panels against real
  data. Re-attaching them would be building a second, worse version of a
  feature that already exists.
- **`wip-set` was a real, live macro with no UI anywhere** (`wip-list` was
  already read by `PjBoardPanel` to render WIP counts/limits per column, but
  nothing could ever set one). Added a small inline number input in each
  Kanban column header (Jira-parity WIP limit editing) that calls
  `lensRun('projects', 'wip-set', { projectId, status, limit })` on blur and
  refreshes.
- Left genuinely low-priority as **BACKEND-CAPABLE-BUT-UNSURFACED, deferred**:
  `view-run` (saved custom board/backlog views — `view-create`/`view-list`
  already exist in `PjSettingsPanel`'s reach but running a saved view isn't
  wired), `integration-link` (attaching an external tracker item to a task,
  distinct from `integration-connect`/`list`/`toggle`/`delete` which are all
  wired), and `label-update` (label rename/recolor — create/delete are
  wired). None of these are core to the Kanban/Scrum/backlog flow a user
  hits day-to-day; they're nice-to-have Linear-parity edges, not defects.
  `activity-list`/`attachment-list`/`relation-list`/`task-comments` are
  **not** missing — they're superseded by the richer composite `task-detail`
  macro (`PjTaskDetail`) which already returns all four in one call.

## Verification

- `npx eslint app/lenses/projects/page.tsx components/projects/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors touching projects files (pre-existing
  errors in `platform`/`queue`/`legacy`/`transfer` are sibling agents'
  concurrent in-flight work in this shared tree, unrelated to this change).
- `node scripts/verify-lens-backends.mjs` — `projects` `WIRED`; total
  unchanged at 258 WIRED / 2 NO-BACKEND-CALL (`narrative-walk`, `ux-suite`,
  both by design).
- `node scripts/grade-ux-polish.mjs --honest` — `projects`: `tier:
  "polished"`, `isGenericScaffold: false`.
- No lens-page-level or `Pj*`-panel test file exists for `/lenses/projects`
  (confirmed by search) — nothing to update.
