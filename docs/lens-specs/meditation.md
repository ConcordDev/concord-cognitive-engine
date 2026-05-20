# meditation — Feature Completeness Spec

Rival app(s): Calm, Headspace (2026)
Sources:
- https://www.calm.com/ (guided meditation, sleep stories, soundscapes, body scan, breathwork, streaks)
- https://www.headspace.com/ (courses, single sessions, sleepcasts, SOS sessions, Nighttime SOS)
- Web search 2026-05-20: Calm/Headspace 2026 — sleep stories, soundscapes, SOS 3-min emergency sessions, breathwork, streaks, mood-adaptive Ebb companion, CBT programs

## Features

### Session library
- [x] Curated 17-session library — guided / breathwork / sleep stories / soundscapes / SOS (macro: meditation.library)
- [x] Filter by category / goal / max duration (macro: meditation.library)
- [x] One-tap play — records a completed session per user (macro: meditation.play)
- [x] Session history (macro: meditation.history)
- [x] Track picker by goal (macro: meditation.pickTrack)

### Breathwork
- [x] Breathwork pacer — box / 4-7-8 / coherent patterns with phase timings (macro: meditation.breathwork)

### Practice tracking
- [x] Streak — current streak, total minutes, days practiced, practiced-today (macro: meditation.streak)
- [x] Mood check-in (1-5) + history with average (macro: meditation.mood-checkin / mood-history)
- [x] Daily mindfulness prompt (macro: meditation.dailyPrompt)
- [x] Meditation dashboard — sessions, minutes, streak, by-category (macro: meditation.meditation-dashboard)
- [x] Legacy artifact-based session log + streak summary (macro: meditation.sessionLog / streakSummary)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real narrated audio (sleep stories, soundscapes) | a licensed audio library + CDN | a curated session library with durations + categories; playback records practice; the `music` lens carries audio playback |
| Ebb AI mood-adaptive companion | a conversational model | mood check-in + history; daily prompt; the `mental-health` lens carries CBT/journal tools |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/meditation.js` clean. 12 macros
  (4 legacy + 8 session substrate).
- 2026-05-20: Tests — `tests/meditation-domain-parity.test.js` 10/10 green
  (library list + filter / play + per-user scope + unknown-id reject /
  streak today + minutes / breathwork patterns + fallback / mood check-in
  average / dashboard by-category / legacy macros intact).
- 2026-05-20: Frontend — new `MeditationStudio` (category-tabbed library,
  one-tap play, breathwork pacer, mood check-in, streak dashboard) mounted
  in the meditation lens page. `npx tsc --noEmit` exit 0.
