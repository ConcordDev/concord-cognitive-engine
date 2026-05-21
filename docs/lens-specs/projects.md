# projects — Feature Gap vs Linear / Asana

Category leader (2026): Linear / Asana (project + issue management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/projects.js` — ~77 macros covering projects, issues, sub-issues, relations, labels, custom fields, comments, attachments, sprints, board+swimlanes+WIP, saved views, milestones/timeline, automation rules, templates, bulk ops, velocity/flow/cycle-time/forecast reports, members, risks, goals.

## Has (verified in code)
- Projects with key/prefix, lifecycle status, health, lead, dates; portfolio rollup
- Issues with status workflow, priority, type, story points, assignee, sprint/milestone, manual rank
- Sub-issue hierarchy + epic rollup; blocks/blocked-by/relates/duplicates relations
- First-class labels, per-project custom fields, threaded comments with @mentions, activity log
- Sprints with burndown + carryover + velocity; kanban board with swimlanes + WIP limits
- Saved views, automation rules (trigger→action), task templates, bulk update/delete
- Reports: velocity, cumulative flow, cycle/lead time, forecast; risk register, goals/OKRs; 7 tabs

## Missing — buildable feature backlog
- [ ] `[M]` Real-time multiplayer sync — live cursors and instant updates across collaborators
- [ ] `[M]` Binary file attachments — upload files to tasks, not just named links
- [ ] `[M]` GitHub/Slack/CI integrations — link PRs, auto-update status, post to channels
- [ ] `[S]` Notification inbox — assigned/mentioned/status-change alerts per user
- [ ] `[S]` Keyboard-driven command bar — Linear-style C-to-create, instant navigation
- [ ] `[M]` Triage / inbox workflow — incoming-issue queue before backlog assignment
- [ ] `[S]` SLA / due-date escalation automation

## Parity
~80% of Linear/Asana's feature surface. This is one of the deepest lenses — issues, sprints, board, automation, custom fields, and a full reporting suite are all real. Gaps are real-time multiplayer, binary attachments, and external integrations.
