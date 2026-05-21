# meditation — Feature Gap vs Calm / Headspace

Category leader (2026): Calm / Headspace (guided meditation & sleep). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/meditation.js` — 12 macros: pickTrack, sessionLog, streakSummary, dailyPrompt, library, play, history, streak, breathwork, mood-checkin, mood-history, meditation-dashboard.

## Has (verified in code)
- Session library — curated tracks (guided/breathwork/sleep/soundscape/SOS), filter by category/goal/duration
- One-tap play — records a completed session per user; session history
- Track picker — goal-banded track selection
- Breathwork pacer — box / 4-7-8 / coherent patterns with phase timings
- Practice tracking — current+longest streak, total minutes, practiced-today
- Mood check-in (1-5) + history with average, daily mindfulness prompt
- Meditation dashboard — sessions/minutes/streak by category; MeditationStudio + journal

## Missing — buildable feature backlog
- [ ] `[M]` Audio playback — actual narrated/ambient audio for sessions (music lens has audio infra to reuse)
- [ ] `[M]` Multi-session courses / programs — structured day-by-day learning paths
- [ ] `[M]` Animated breathing visual — guided expand/contract animation synced to pacer
- [ ] `[S]` Reminders / scheduled practice notifications
- [ ] `[M]` Sleep timer + sleep-story mode with fade-out
- [ ] `[S]` Personalized recommendations — adapt track suggestions to mood + history
- [ ] `[S]` Milestones / achievements — streak badges, total-minutes rewards

## Parity
~50% of Calm/Headspace's surface. Real session library, breathwork pacer, streaks, mood check-in, and dashboard, but missing audio playback, multi-session courses, animated breathing visuals, and reminders that make a meditation app a daily habit.
