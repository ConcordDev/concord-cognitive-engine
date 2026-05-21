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
- [ ] `[M]` OKR alignment tree — link key results to parent objectives across teams
- [ ] `[S]` Cadence check-ins (weekly status with confidence ratings)
- [ ] `[M]` Team / shared goals with per-member contribution
- [ ] `[S]` Goal templates by category + recurring goals
- [ ] `[S]` Progress charts — burndown / trend over time
- [ ] `[M]` Reminders + scheduled review prompts
- [ ] `[S]` Goal dependencies (this goal blocks that one)

## Parity
~60% of a modern OKR tool's surface. OKR scoring, decomposition, forecasting, and gamification form a real goal tracker, but it lacks the alignment tree, cadence check-ins, and team/shared goals that define OKR software like Weekdone.
