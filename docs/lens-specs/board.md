# board — Feature Gap vs Trello

Category leader (2026): Trello. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/board.js` — 15 macros: board create/list/detail/delete, column add/delete, card create/move/update/checklist-toggle/delete, dashboard, workflowAnalysis, cardPrioritization, burndownForecast.

## Has (verified in code)
- Multiple kanban boards (auto-seeds To Do / In Progress / Done), per-user
- Columns: add/delete (delete cascades cards); cards with labels, due date, assignee
- Card move between columns with server-side repositioning; checklists with toggle
- Card create/update/delete; board dashboard (overdue count, cards-with-checklists)
- Workflow analysis, card prioritization, burndown forecast
- KanbanBoard UI; BggHotList panel (BoardGameGeek live feed)

## Missing — buildable feature backlog
- [ ] `[M]` Drag-and-drop card movement (move-left/right buttons only today)
- [ ] `[M]` Card detail modal with comments, attachments, activity feed
- [ ] `[S]` Calendar / timeline view of cards by due date
- [ ] `[S]` Card cover images and rich-text descriptions
- [ ] `[M]` Board automation rules ("when moved to Done → check all items")
- [ ] `[S]` Label management UI + filtering by label/assignee
- [ ] `[M]` Board sharing / collaborators with permissions
- [ ] `[S]` Power-ups / custom fields on cards

## Parity
~58% of Trello's surface. The board/column/card/checklist substrate is complete and real; gaps are drag-and-drop, the card detail modal (comments/attachments), and automation rules.
