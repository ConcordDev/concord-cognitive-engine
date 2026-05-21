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
- [ ] `[M]` Photo/media attachments per entry — Day One's core is rich multimedia entries
- [ ] `[S]` Calendar / heatmap view of entries (streak grid)
- [ ] `[M]` Habit builder with reminders and scheduled check-ins (streaks exist but no creation flow)
- [ ] `[S]` Entry templates (gratitude, daily reflection, goals)
- [ ] `[S]` Tags + tag-based filtering across entries
- [ ] `[M]` Encrypted/private journal lock with passcode
- [ ] `[S]` Export journal to PDF/Markdown archive

## Parity
~55% of a Day One+Reflectly composite. Strong journaling, mood, search, and on-this-day; missing media attachments, calendar heatmap, and a real habit-builder flow.
