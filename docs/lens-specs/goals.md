# goals — Feature Gap vs Notion / Weekdone OKR

Category leader (2026): Weekdone / Mooncamp (OKR) + Notion goals. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `goals` domain — okrScoring, goalDecomposition, progressForecast; generic artifact store for goals; ProductivityFeed component.

## Has (verified in code)
- Goal CRUD with progress tracking; OKR scoring (objective + key-result roll-up)
- Goal decomposition — break a goal into sub-goals / milestones
- Progress forecasting (will you hit the target on time)
- Streaks, achievements, milestones, XP / gamification (Flame, Trophy, Award icons)
- Productivity feed; goal contributions / check-ins

## Missing — buildable feature backlog
- [x] `[M]` OKR alignment tree — link key results to parent objectives across teams
- [x] `[S]` Cadence check-ins (weekly status with confidence ratings)
- [x] `[M]` Team / shared goals with per-member contribution
- [x] `[S]` Goal templates by category + recurring goals
- [x] `[S]` Progress charts — burndown / trend over time
- [x] `[M]` Reminders + scheduled review prompts
- [x] `[S]` Goal dependencies (this goal blocks that one)

## Parity
~95% of a modern OKR tool's surface. OKR scoring, decomposition, forecasting, gamification plus an alignment tree, cadence check-ins, team/shared goals, recurring-goal templates, progress charts, review reminders, and dependency tracking all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
