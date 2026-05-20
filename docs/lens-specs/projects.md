# projects — Feature Completeness Spec

Rival app(s): Linear, Asana, Jira
Sources:
- https://linear.app/docs
- https://linear.app/changelog/2026-04-30-releases
- https://asana.com/features
- https://help.asana.com/s/article/learn-about-asana-advanced-features
- https://support.atlassian.com/jira-software-cloud/docs/example-jql-queries-for-board-filters/

## Features

### Projects / workspace
- [x] Create / list / get / update / delete projects (macro: projects.project-*)
- [x] Project key / prefix + sequential issue refs (KEY-N)
- [x] Project description + color
- [x] Project lifecycle status — planned/started/paused/completed/canceled
- [x] Project lead/owner (member)
- [x] Project start date + target date
- [x] Project health — on_track/at_risk/off_track
- [x] Archive / unarchive a project
- [x] Portfolio rollup — all projects with progress, health, status

### Issues / tasks
- [x] Create / list / update / delete tasks
- [x] Status workflow — backlog/todo/in_progress/in_review/done
- [x] Priority — none/low/medium/high/urgent
- [x] Issue type — story/bug/task/epic/chore
- [x] Story points / estimate
- [x] Start date + due date
- [x] Assignee
- [x] Sprint + milestone assignment
- [x] Quick status move
- [x] Backlog rank / manual ordering

### Sub-issues / hierarchy
- [x] Parent/child sub-issues (task.parentId)
- [x] Epic → child stories rollup (progress + points)
- [x] Re-parent a task

### Dependencies / relations
- [x] blocks / blocked_by / relates / duplicates relations
- [x] Relation list per task
- [x] Relation delete
- [x] Blocked-task surfacing on the board

### Labels
- [x] First-class labels with name + color
- [x] Label create / list / update / delete
- [x] Tasks carry labels; board renders label colors

### Custom fields
- [x] Define per-project custom fields — text/number/select/date
- [x] Set custom-field values on tasks
- [x] Custom-field delete

### Comments & activity
- [x] Comments on tasks
- [x] Threaded replies (parent comment)
- [x] @mention parsing
- [x] Per-task activity history / audit log

### Attachments
- [x] Attach named links to a task
- [x] Attachment list / delete

### Sprints / cycles
- [x] Create / list / complete sprints
- [x] Burndown (ideal vs remaining)
- [x] Unfinished-work carryover
- [x] Sprint velocity (historical points/sprint)

### Board & backlog
- [x] Kanban board grouped by status
- [x] Swimlanes — group board by assignee/epic/priority
- [x] WIP limits per column + over-limit flag
- [x] Backlog view + drag rank ordering

### Views & filters
- [x] Filter by status/assignee/label/sprint/type
- [x] Saved views (named filter+sort presets)
- [x] Run a saved view
- [x] Sort options (priority/created/due/rank)

### Milestones & timeline
- [x] Create / list / complete / delete milestones with progress
- [x] Timeline/Gantt data — tasks with start+due on a date axis

### Automation
- [x] Automation rules — trigger (status_changed/created/assigned) → action (set priority/assignee/label/sprint/status)
- [x] Rules evaluate live on task create/update/move
- [x] Rule create / list / delete

### Templates
- [x] Task templates (with default fields + seeded subtasks)
- [x] Apply a template to create a task tree
- [x] Template list / delete

### Bulk operations
- [x] Bulk update tasks (status/priority/sprint/assignee/labels)
- [x] Bulk delete tasks

### Reporting
- [x] Project dashboard (status/priority counts, completion, overdue)
- [x] Velocity report (completed points per sprint)
- [x] Cumulative flow (status counts over time)
- [x] Cycle-time / lead-time report
- [x] Forecast (remaining points ÷ avg velocity → projected sprints)

### Team
- [x] Add / list / delete members with roles
- [x] Per-member workload

### Risk & goals
- [x] Risk register — likelihood × impact → severity, mitigation
- [x] Goals/OKRs linked to a project with progress

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time multiplayer cursors / live sync | WebSocket CRDT infra | per-user STATE; reload reflects latest |
| GitHub/Slack/CI integrations | external OAuth apps | attachments accept links; activity log records events manually |
| File uploads (binary attachments) | object storage | attachments store named URLs |

## Verification log
- 2026-05: backend `node --test tests/projects-domain-parity.test.js` → 34/34 green (77 macros).
- 2026-05: `npx tsc --noEmit` exit 0 across all 11 projects components.
- 2026-05: `npm run score-lenses` → projects 7/7 PASS.
- Every spec feature is implemented (backend macro + frontend panel + test). Boundary
  register holds only the 3 genuine infrastructure items. Zero unchecked non-boundary lines.
