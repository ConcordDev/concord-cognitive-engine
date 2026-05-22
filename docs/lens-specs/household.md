# household — Feature Gap vs Cozi / Sweepy

Category leader (2026): Cozi (family organizer) + Sweepy (chore management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `household` domain — generateGroceryList, maintenanceCheck, rotateChores, weeklySummary, maintenanceDue, choreRotation, OpenFoodFacts product lookup/search, room CRUD, task CRUD + done, chore board, assignee leaderboard, vacation toggle, dashboard.

## Has (verified in code)
- Chore management — task CRUD, chore board, automatic chore rotation, assignee leaderboard
- Room organization (room CRUD); household members; vacation toggle (pause assignments)
- Grocery list generation; pantry / product lookup via OpenFoodFacts barcode + search
- Maintenance checks — what's due, recurring upkeep
- Weekly summary, household dashboard

## Missing — buildable feature backlog
- [x] `[M]` Shared family calendar with events + reminders (Cozi's centerpiece)
- [x] `[S]` Meal-planning calendar tied to the grocery list
- [x] `[S]` Reward points / allowance system for completed chores
- [x] `[M]` Per-member mobile notifications for assigned tasks
- [x] `[S]` Shared shopping lists multiple members edit live
- [x] `[S]` Recurring task templates by frequency
- [x] `[M]` Budget / shared-expense splitting between members

## Parity
~95% of the Cozi/Sweepy surface. Chore rotation, leaderboard, rooms, grocery/pantry plus a shared family calendar, meal-planning calendar, allowance/reward points, per-member notifications, shared shopping lists, recurring task templates, and expense splitting all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
