# daily — Feature Completeness Spec

Rival app(s): Day One, Journey (2026)
Sources:
- https://dayoneapp.com/ (dated entries, mood, tags, photos, on-this-day, streaks, multiple journals, daily prompts, search)
- https://journey.cloud/ (journaling, mood trend)

Previously the daily domain was productivity-flavored compute-only
(daily summary, focus timer, habit streaks). This spec covers the new
journaling substrate that makes `daily` a real Day One shadow.

## Features

### Journals & entries
- [x] Multiple journals — auto-seeded default, create, list with counts (macro: daily.journal-create / journal-list)
- [x] Dated entries — body, mood (1-5), tags, weather, location (macro: daily.entry-create)
- [x] Entry list — filter by journal / tag / month, newest-first timeline (macro: daily.entry-list)
- [x] Entry detail / update / delete (macro: daily.entry-detail / entry-update / entry-delete)

### Memories & reflection
- [x] On This Day — same month-day entries from prior years (macro: daily.on-this-day)
- [x] Daily journaling prompt — rotates daily (macro: daily.prompt-today)
- [x] Full-text search across body / title / tags (macro: daily.entry-search)
- [x] Mood trend — average mood per date over time (macro: daily.mood-trend)
- [x] Dashboard — total entries, days journaled, current streak, this-month, wrote-today (macro: daily.daily-dashboard)

### Productivity helpers (retained)
- [x] Daily summary — tasks / focus / mood / productivity score (macro: daily.dailySummary)
- [x] Habit streak tracking (macro: daily.habitStreak)
- [x] Focus timer aggregation (macro: daily.focusTimer)
- [x] Weekly review (macro: daily.weeklyReview)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Photo / media entries | a blob store | text entries with weather + location fields; artifact DTUs carry media separately |
| Automatic weather/location capture | device sensors + a weather API | optional weather/location fields on each entry |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/daily.js` clean. 16 macros
  (4 productivity helpers + 12 journaling substrate).
- 2026-05-20: Tests — `tests/daily-domain-parity.test.js` 12/12 green
  (journal auto-seed + per-user scope / entry CRUD + mood clamp + tag filter /
  on-this-day prior-year match / search / mood-trend averaging / dashboard
  streak / prompt / productivity helpers intact).
- 2026-05-20: Frontend — new `DailyJournal` component (mood+tag composer with
  daily prompt, timeline, On This Day, search, mood average, streak stats)
  mounted in the daily lens page. `npx tsc --noEmit` exit 0.
