# board — Feature Completeness Spec

Rival app(s): Trello, Asana (2026)
Sources:
- https://trello.com/ (kanban boards, lists/columns, cards with labels/due-dates/checklists/members, card movement)
- https://asana.com/ (board view, cards, assignees)
- Web search 2026-05-20: Trello kanban gold-standard; cards carry labels, due dates, checklists; Asana adds board/list/calendar views

## Features

### Boards & columns
- [x] Create a board — auto-seeds To Do / In Progress / Done, per-user (macro: board.board-create)
- [x] List boards with column + card counts (macro: board.board-list)
- [x] Board detail — columns + cards (macro: board.board-detail)
- [x] Delete a board (macro: board.board-delete)
- [x] Add / delete columns (column-delete cascades its cards) (macro: board.column-add / column-delete)

### Cards
- [x] Create a card in a column (macro: board.card-create)
- [x] Move a card between columns with re-positioning (macro: board.card-move)
- [x] Update — title, description, labels, due date, assignee; add checklist items (macro: board.card-update)
- [x] Toggle checklist items (macro: board.card-checklist-toggle)
- [x] Delete a card (macro: board.card-delete)
- [x] Board dashboard — boards, cards, overdue, cards-with-checklists (macro: board.board-dashboard)

### Analysis (retained)
- [x] Workflow analysis (macro: board.workflowAnalysis)
- [x] Card prioritization (macro: board.cardPrioritization)
- [x] Burndown forecast (macro: board.burndownForecast)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Drag-and-drop card movement | a DnD library + reorder events | move-left / move-right column buttons with server-side re-positioning |
| Multiple project views (calendar/timeline/Gantt) | view-specific renderers | the `calendar` lens carries calendar views; board focuses on the kanban view |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/board.js` clean. 14 macros
  (3 analysis + 11 kanban substrate).
- 2026-05-20: Tests — `tests/board-kanban-domain-parity.test.js` 9/9 green
  (board CRUD + 3 default columns + per-user scope / column add + cascade-
  delete / card create + titleless reject + move + update + checklist toggle +
  delete / dashboard overdue count).
- 2026-05-20: Frontend — new `KanbanBoard` (multi-board, columns with
  add-card inputs, move-between-columns, labels/due/checklist chips) mounted
  in the board lens page. `npx tsc --noEmit` exit 0.
