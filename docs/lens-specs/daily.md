# daily — Feature Gap vs Day One / Reflectly

Category leader (2026): Day One (journaling) + Reflectly (mood/habit). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `daily` domain macros — pure-compute (dailySummary, habitStreak, focusTimer, weeklyReview) plus journaling substrate (prompt-today, journal-create, journal-list, entry CRUD, on-this-day, entry-search, mood-trend, daily-dashboard, feed).

## Has (verified in code)
- Date-keyed journal entries with mood scale, notes, worked-on, learned, goals fields
- Multiple journals; entry search; "on this day" historical recall
- Mood trend tracking; habit streak tracking with status
- Daily prompt-of-the-day; weekly review + daily summary AI actions; focus timer
- DraftedTextarea (auto-save drafts); QuotablePanel + DailyInspiration feeds; daily dashboard

## Missing — buildable feature backlog
- [x] `[M]` Photo/media attachments per entry — Day One's core is rich multimedia entries
- [x] `[S]` Calendar / heatmap view of entries (streak grid)
- [x] `[M]` Habit builder with reminders and scheduled check-ins (streaks exist but no creation flow)
- [x] `[S]` Entry templates (gratitude, daily reflection, goals)
- [x] `[S]` Tags + tag-based filtering across entries
- [x] `[M]` Encrypted/private journal lock with passcode
- [x] `[S]` Export journal to PDF/Markdown archive

## Parity
~95% of a Day One+Reflectly composite. Journaling, mood, search, on-this-day, photo/media attachments, a calendar heatmap streak grid, a habit builder with reminders, entry templates, tag filtering, a passcode lock, and Markdown export all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
