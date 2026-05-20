# household — Feature Completeness Spec

Rival app(s): Tody, Sweepy (2026)
Sources:
- https://todyapp.com/ (condition-based cleaning — tasks "get dirty" over time, prioritised board, vacation/pause mode)
- Sweepy (rooms → tasks, assignees, points + leaderboard, gamification)
- Web search 2026-05-20: Tody FairShare labour balance, vacation mode, Dusty challenges; Sweepy rooms/jobs, assign to family, points leaderboard, work approval

## Features

### Rooms & condition-based chores
- [x] Rooms — create / list (with task counts) / delete (cascades tasks) (macro: household.room-create / room-list / room-delete)
- [x] Recurring chores per room — interval, effort (light/medium/heavy), assignee (macro: household.task-create)
- [x] Condition tracking — each task drifts clean → getting-dirty → needs-attention relative to its interval (macro: household.task-list)
- [x] Mark a chore done — resets condition, awards effort-scaled points (macro: household.task-done)
- [x] Update / delete chores (macro: household.task-update / task-delete)

### Board, people & pause
- [x] Chore board — prioritised cross-room list, most urgent first (macro: household.chore-board)
- [x] Assignee leaderboard — points + chores-done per person (macro: household.assignee-leaderboard)
- [x] Vacation mode — pause freezes conditions; resume shifts the clock forward so nothing jumps to "filthy" (macro: household.vacation-toggle)
- [x] Household dashboard — cleanliness %, rooms, chores, urgent count (macro: household.household-dashboard)

### Provisioning helpers (retained)
- [x] Grocery list generation (macro: household.generateGroceryList)
- [x] Maintenance check + due tracking (macro: household.maintenanceCheck / maintenanceDue)
- [x] Chore rotation (macro: household.rotateChores / choreRotation)
- [x] Weekly summary (macro: household.weeklySummary)
- [x] Open Food Facts product lookup + search (macro: household.off-product-lookup / off-product-search)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Push reminders when a chore goes overdue | a device notification channel | the chore board surfaces overdue tasks ranked by urgency; dashboard urgent count |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/household.js` clean. 21 macros
  (8 provisioning helpers + 13 chore substrate).
- 2026-05-20: Tests — `tests/household-domain-parity.test.js` 10/10 green
  (room CRUD + cascade / condition clean→needs-attention / task-done points +
  reset / chore-board urgency sort / leaderboard / vacation freeze-and-resume /
  dashboard / helpers intact).
- 2026-05-20: Frontend — new `ChoreBoard` (rooms, chore board with condition
  dots, leaderboard, vacation toggle) mounted in the household lens page.
  `npx tsc --noEmit` exit 0.
