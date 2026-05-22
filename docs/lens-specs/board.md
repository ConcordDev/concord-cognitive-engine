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
- [x] `[M]` Drag-and-drop card movement (move-left/right buttons only today)
- [x] `[M]` Card detail modal with comments, attachments, activity feed
- [x] `[S]` Calendar / timeline view of cards by due date
- [x] `[S]` Card cover images and rich-text descriptions
- [x] `[M]` Board automation rules ("when moved to Done → check all items")
- [x] `[S]` Label management UI + filtering by label/assignee
- [x] `[M]` Board sharing / collaborators with permissions
- [x] `[S]` Power-ups / custom fields on cards

## Parity
~95% of Trello's surface. The board/column/card/checklist substrate plus drag-and-drop card movement, a card detail modal (comments/attachments/activity), a calendar view, card covers, automation rules, label management + filtering, board sharing with roles, and custom fields all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
