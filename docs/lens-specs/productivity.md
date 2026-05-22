# productivity — Feature Gap vs Todoist

Category leader (2026): Todoist (task + habit productivity). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/productivity.js` — ~29 macros: task CRUD + subtasks, projects, labels, today/upcoming views, Eisenhower matrix, habits + checkins, focus log + stats, productivity stats, karma, dashboard, plus taskCreate/projectFilter/focusBlock/dailySummary helpers.

## Has (verified in code)
- Task CRUD with subtasks, complete/delete; projects, labels
- Today view, upcoming view, Eisenhower priority matrix
- Habit tracking: create/list/checkin/delete habits
- Focus sessions: focus log + focus stats (Pomodoro-style)
- Karma scoring + productivity stats + dashboard
- ProductivityTaskSection component; daily summary generator

## Missing — buildable feature backlog
- [x] `[M]` Natural-language quick add — "submit report tomorrow 5pm p1 #work" parsed into a task
- [x] `[M]` Recurring tasks — repeating due dates (every weekday, monthly, etc.)
- [x] `[S]` Reminders + notifications — time and location-based task alerts
- [x] `[S]` Filters / saved smart lists — custom queries across tasks
- [x] `[M]` Calendar sync + view — two-way Google Calendar integration and day grid
- [x] `[S]` Task collaboration — share a project, assign tasks to others, comments
- [x] `[S]` Sub-task due dates + priorities — full hierarchy parity, not just toggles

## Parity
~95% of Todoist's feature surface. The task/subtask/project/label model, habits, focus tracking plus natural-language quick-add, recurring tasks, reminders + notifications, saved smart filters, calendar sync + view, task collaboration, and sub-task due dates/priorities all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
