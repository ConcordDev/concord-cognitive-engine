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
- [ ] `[M]` Shared family calendar with events + reminders (Cozi's centerpiece)
- [ ] `[S]` Meal-planning calendar tied to the grocery list
- [ ] `[S]` Reward points / allowance system for completed chores
- [ ] `[M]` Per-member mobile notifications for assigned tasks
- [ ] `[S]` Shared shopping lists multiple members edit live
- [ ] `[S]` Recurring task templates by frequency
- [ ] `[M]` Budget / shared-expense splitting between members

## Parity
~60% of the Cozi/Sweepy surface. Chore rotation, leaderboard, rooms, and grocery/pantry are a real household manager, but it lacks a shared family calendar, meal-planning calendar, and per-member notifications — the coordination layer Cozi is built on.
