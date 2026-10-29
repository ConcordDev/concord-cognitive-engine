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
>   **Removed in the Review 4 rework (B10, 2026-10-28):** the greeting
>   and its test are out per the Lens Rework rules; the page header is
>   the plain "Projects" title again.
> - Server suites run locally this pass: projects-domain-parity
>   passes (in the combined 82-pass L12 run).


## Rework — Product Review 4 (projects.md), B10, 2026-10-28

Review of record: `~/workspace/your_files/concord-product/lens-reviews/projects.md`
(97 features, 24 failed; slices S1–S14 + D1–D4 in its §7; S4 parked on
Ramaj's §8 Q2 team-model call). S1 (lifecycle) notes:

- The lifecycle macros were already in the domain — `project-delete`
  (with cascade) and `project-archive` in both directions were among
  the macros above — but no surface called delete, and archive was
  called one-way only. They are surfaced now: labelled Archive and
  Delete with named confirmations in the project header, and Restore
  + Delete for archived projects in Portfolio.
- The chip × previously called `project-delete` directly — a close
  gesture that silently deleted the project (Review 4's missing
  "PR4 Close Test"); it is a deselect now, reopenable in one click.
- `project-delete`'s cascade now also clears the task-scoped stores
  (comments, attachments, activity, relations) and the lazily created
  project-scoped stores (integrations, SLA policies, notifications);
  pinned by `server/tests/projects-lifecycle.test.js`.
- Frontend behaviour: `concord-frontend/tests/projects-lifecycle.test.tsx`.

D1 + D4 (receipt + settle) and D2 (triage front door) notes:

- D1: `sprint-complete` now computes the settlement BEFORE
  rollover (issues and points, done of total — the numbers
  report-velocity reconciles from), returns it as `receipt`, and
  keeps it: one `sprint_receipt` activity entry on every settled
  issue, so it lives in the per-issue feeds and the S11 Activity
  stream and survives reload. Re-completing an already-completed
  sprint writes no second receipt. The DTU-id half of D1 rides the
  chrome save flow (see F17, NEEDS-CROSS-LENS) — the receipt here
  is the lens-side kept record.
- D4: the Sprints panel renders the receipt as a stamped card on
  completion (250 ms settle-in, static under
  prefers-reduced-motion), and completed sprint cards carry the
  settlement figures; velocity is already derived live by
  `report-velocity`, so it lands in Reports in the same beat by
  construction. The E-PJ-1 egg ships: a completed sprint whose
  every point is done shows the "Settled in full." stamp on its
  card (and in its receipt). Tests:
  `server/tests/projects-receipts.test.js` (0 pass / 2 fail
  against the original domain).
- D2: the section shows a triage header banner whenever the open
  project has un-triaged issues ("N issues need triage" +
  Review triage → the Collab tab), rechecked on project/tab
  change so emptying the queue clears it. The intake room itself
  was already verified working (Collab triage inbox); D2 is the
  door, not a rebuild.
- D3 stays parked with S4 on Ramaj's §8 Q2 call.

S13 (first-run, F20) notes:

- The zero-project landing no longer says "Nothing in the
  substrate." It states what a project is in one sentence, names
  the loop (issues → board → goals/reports → DTU), and offers the
  sample project beside New project. The sample is a REAL project
  (`project-create-sample`, idempotent per account, `sample: true`,
  SMP key uniquified) with four teaching issues across the
  statuses — labelled in the list and by a banner in its header,
  editable and deletable like any project. The create dialog gained
  a starter row (Blank / Product launch / Bug triage / Content
  series): `project-create` accepts `template` and seeds four
  starter issues in the same call (one already Done, so a system
  goal counts 1 from minute one). Tests:
  `server/tests/projects-starters.test.js` (0 pass / 3 fail against
  the original domain).

S14 (label honesty, F21) notes:

- The Backlog rank chevrons were aria-labelled "Collapse" /
  "Expand" while doing rank reorder; they are now "Move up" /
  "Move down" (label + tooltip). The Board's new-task bar now
  submits on Enter, matching every comparable surface (the related
  mismatch recorded inside F21).

S12 (state freshness, F17/F18/F19) notes:

- F18 BUILT (the in-lens half): the lens's own writes now render in
  the same interaction. The project header's status/health selects
  apply the patch to local state immediately (refetch reconciles,
  and Portfolio — fed from the same list — is right on first
  entry); Team adds append the returned member at once, the panel
  no longer blanks to a skeleton on refresh, and a stale
  "Member name is required." dies as soon as the user types;
  Settings rule/template deletes remove the row in the same click
  (the refetch restores it if the delete actually failed).
- F17 NEEDS-CROSS-LENS: the review's own inventory (§2b #79/#80)
  files "Save project as DTU" / "Draft in Thread" / the saved-state
  indicator under **Lens chrome**, not this lens's components — no
  Projects component contains them (grepped). The indicator must
  read a persisted {dtuId, savedAt} record; the save itself happens
  in chrome's generic DTU flow, which no Projects macro sees. If
  the office wants the record held by the lens, B10 will add a
  `project-note-dtu-save` write + `project-get` read in one small
  slice — the chrome wiring is the external half.
- F19 NEEDS-CROSS-LENS by the review's own routing: its spec names
  "the platform-chrome slice family that carries Studio's S12" as
  the home for one-connection-source status signs. No Projects
  component renders the banner, badge, or sidebar dot.

S11 (activity + notifications, F15/F16) notes:

- F15: `activity-list` hard-required a taskId, so any global call
  filtered on taskId === "undefined" and the feed read "No activity
  yet" forever. Without a taskId it now returns the account's
  stream (newest first, optional projectId scope, rows enriched
  with the issue's ref/title/project). The lens gained an Activity
  tab rendering that stream grouped by issue. The per-issue call
  is byte-for-byte the original shape. Tests:
  `server/tests/projects-activity.test.js` (1 pass / 2 fail against
  the original domain — the cross-user test passes vacuously there,
  since the old stream was empty for everyone).
- F16 is NEEDS-CROSS-LENS, stated plainly: the top-bar bell is
  `components/social/NotificationBell` reading the SOCIAL store
  (`/api/social/notifications`) — platform chrome outside the
  Projects file set. The Projects store the Collab inbox reads
  (`notifications-list` / mark-read / clear) is single and working;
  converging the bell onto one store is a shell/social slice for
  the Overseer to route, not something this PR can do without
  reaching into another lens's surface.

S10 (key uniqueness, F13) notes:

- Project keys are unique per account, because issue refs (PR4-1)
  are built from them. An explicitly requested key that is taken is
  rejected, naming the holder project and suggesting the next free
  key (PR4 → PR42); an auto-derived key uniquifies silently. A
  duplicate project name returns a distinct `duplicate_name` code:
  the create dialog shows "A project named X already exists" with a
  Create-anyway action that retries with explicit confirmation —
  unconfirmed, nothing is created. Tests:
  `server/tests/projects-keys.test.js` (1 pass / 3 fail against the
  original domain).

S9 (goal reconcile, F12) notes:

- A goal whose metric names a system measure ("Tasks done",
  "Points done"/"points", "Issues closed" — matched on normalized
  metric text, so goals typed before this slice count too) now
  computes its current value live in `goal-list` from project state
  and returns `countedRefs` — the exact issues behind the number,
  shown under the goal. Typing a value into a system goal is
  refused ("its value cannot be typed; complete issues to move
  it"); target edits still work. Other metrics stay manual and are
  labelled "manual" in Planning; the create form offers the three
  system metrics as "counted live" choices plus a custom manual
  metric. Tests: `server/tests/projects-goals.test.js` (0 pass / 4
  fail against the original domain).

S8 (constraints, F10/F11) notes:

- WIP limits and blocked-by relations were display-only; both are
  now enforced in the domain at every status-write path (task-create,
  task-update, task-move-status, task-bulk-update, triage-accept). A
  WIP refusal names the limit and column; bulk moves are gated as a
  group (the column must fit all incoming). A blocked issue cannot
  move to In Progress/Done while a blocker is incomplete — unless the
  caller overrides, which writes an "override" receipt (with the
  blocker refs) into the issue's Activity. The task detail surfaces
  refusals with a "Move anyway — recorded in Activity" action; Board
  drags and Backlog bulk moves surface the refusal text. Automation
  rules (the project's own engine) still act directly, as before.
  Tests: `server/tests/projects-constraints.test.js` (1 pass / 5
  fail against the original domain).

S7 (typing + focus integrity, F8/F9) notes:

- The garble mechanism, hand-found: custom-field inputs bound
  straight to server state and saved PER KEYSTROKE, so each save's
  refresh snapped the input back mid-typing; title/description drafts
  lived in the same detail object a sibling save's refresh replaced;
  the Board blanked its whole tree (open task detail included) on
  every re-fetch; and the Backlog panel swapped its entire tree —
  search box included — for a skeleton whenever a fetch returned
  zero rows.
- Now: title/description/custom-field text values are local drafts
  committed on blur/Enter, synced from the server only when a
  different task opens; the Board blanks only on first load; the
  Backlog filters stay mounted (the skeleton covers only the list
  region) and stale list responses can no longer land out of order.
  Tests: `concord-frontend/tests/projects-typing.test.tsx`.

S6 (date integrity, F7) notes:

- The corruption was a write-path shape: `pjDay` slices any string to
  yyyy-mm-dd, so a mangled year (0002) stored as happily as a real
  one, and `sprint-create` silently defaulted missing/unparseable
  dates and never checked range order. A strict write-path check
  (`pjDayStrict` — real calendar date, four-digit year) now guards
  task create/update, sprint create, milestone create and project
  create/update: provided-but-invalid is a named rejection, nothing
  is stored or substituted. Sprint end-before-start is rejected in
  the domain and pre-checked in the sprint form's own words. Absent
  dates keep their defaults. Tests:
  `server/tests/projects-dates.test.js` (1 pass / 5 fail against the
  original domain — only exact-storage of a valid date pre-existed).

S5 (⌘K content search, F6) notes:

- `command-search` already existed and Collab's palette already
  called it — the finding's break was downstream: results rendered as
  inert divs (no click, no Enter, no keyboard selection), the search
  was scoped to the current project while the bar promises "projects
  & issues", and the palette existed only on the Collab tab while the
  global lens palette took ⌘K everywhere else in the lens.
- Now: results are buttons with arrow-key selection and Enter; a task
  result jumps to its project and opens the issue on the Board
  (PjBoardPanel takes an open-task request), a project result jumps
  to the project; the search call is unscoped (results carry their
  projectId); ProjectsSection claims ⌘K in the capture phase while
  the lens is mounted (the global palette listens on document,
  bubble phase) and routes to Collab's palette. The repo's Collab
  test was updated for the unscoped call and gained jump coverage;
  substrate pinned by `server/tests/projects-search.test.js`.

S3 (Portfolio truth, F2/F3 remainder) notes:

- Chip-close semantics landed with S1 (× deselects; reopenable in one
  click from the Closed row) on the strength of the §8 Q1
  determination: the old × called `project-delete` — CLS was deleted,
  not hidden.
- Portfolio now defaults to the active set: archived projects sit
  behind a "Show archived (N)" toggle, the heading reports active and
  archived counts, and shown archived rows keep their S1 Archived
  marker + Restore/Delete — heading and rows always describe the same
  set.

S2 (identity, F5) notes:

- Rename, description and project dates ride the existing
  `project-update` macro — it was surface-missing only; Settings now
  opens with a Project section driving it, and the save refreshes the
  switcher/Portfolio in the same interaction.
- `project-duplicate` is a NEW macro in this rework: a structural
  copy (tasks with hierarchy/assignments, relations, sprints,
  milestones, members, labels, fields, views, rules, templates,
  risks, goals, WIP) under a new id and key, refs re-sequenced. It
  does not copy comments/attachments/activity (the original's
  history) or integrations/SLA/triage (external connections). The
  copy's `duplicatedFrom` records the source project, name, key and
  time — the citation the Settings surface shows. Tests:
  `server/tests/projects-identity.test.js`,
  `concord-frontend/tests/projects-identity.test.tsx`.

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

## S4/D3 delta — assignment identity, real accounts only (2026-10-29)

Branch `feat/lens-projects-assignment-s4` (stacked on
`feat/lens-projects-analytics-redesign`; founder ruling §8 Q2:
real accounts only — no free-text member or assignee path).

CHANGED (domain, server/domains/projects.js):
- Membership IS the platform ACL (server/lib/artifact-acl.js, #1789;
  first domain adoption): the domain registers the "project" owner
  resolver at registration and builds its manager over
  `globalThis._concordSTATE.db`. member-list = owner + active
  grantees (grant level view/edit is the role), display names resolved
  via server/lib/user-identity.js at read time, never stored.
- member-add = ACL grant by @username (or account id, resolved against
  the users table); member-delete = ACL revoke + unassign that
  account's tasks in the project. Free-text adds refused in words;
  unknown accounts refused by name; the owner cannot be removed.
- task.assigneeId now holds an ACCOUNT userId. The valid set (owner ∪
  active grantees) is enforced at task-create, task-update (named
  refusal), task-bulk-update, triage-accept, automation set_assignee,
  and project leadId. Self-assignment works by construction (F4).
- Migration (remove-and-receipt, S4 plan §4): legacy free-text member
  records are deleted on first read, their tasks unassigned, ONE
  activity receipt (members_migrated) per affected project with
  counts. Idempotent.
- project-duplicate copies NO membership (grants are per-artifact);
  tasks keep an assignment only when the assignee is the owner.
- NEW macros: my-work (the caller's open assignments across projects,
  due-sorted, project refs attached) and shared-with-me (ACL
  listSharedWith discovery — name/key/level only; task reads inside
  another account's store ride the platform shared read path, not
  this slice).

CHANGED (frontend): PjTeamPanel rewritten for accounts (username +
level add form, owner pinned/undeletable, revoke passes project
scope); NEW PjMyWorkPanel (due-state groups, complete-through writes
task-move-status, shared-with-you discovery rows); ProjectsSection
gains the My Work tab (first) and the D3 landing rule (returning
user with open assignments lands on My Work, decided once at load).

Suites: server/tests/projects-assignment.test.js (9, new);
projects-identity + projects-domain-parity updated to the account
contract (disclosed changes — the parity suite's state now carries
an in-memory db, the pattern of the repo's own artifact-acl suite);
concord-frontend/tests/projects-assignment.test.tsx (5, new).
Automation rules with a set_assignee value that is not a member
no-op silently (system actor); explicit user choices refuse by name.
