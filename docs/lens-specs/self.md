# self — Feature Gap vs Apple Health / Gyroscope

Category leader (2026): Apple Health / Gyroscope (quantified-self dashboard). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: aggregates other lens domains via `runDomain` — fitness, sleep, affect/mental_health, journal/atlas — plus `/api/world/achievements/:userId` and `/api/world/sim/achievements`.

## Has (verified in code)
- 9 tabs: overview, fitness, sleep, mood, journal, rituals, achievements, milestones, season
- Unified dashboard pulling fitness (workouts/weekly minutes), sleep (avg hours/quality), mood (affect/mental-health), recent journal entries
- Achievements: unified [{name, category, unlocked, progress, target, percent}] from server, split into achievements + progress
- Daily rituals, milestones, seasonal-content tabs

## Missing — buildable feature backlog
- [ ] `[M]` Cross-metric correlation — surface "you sleep better on workout days" style insights
- [ ] `[M]` Trend charts — time-series graphs for each metric, not just current values
- [ ] `[S]` Health-data import — wearable / Apple Health / Google Fit ingestion
- [ ] `[S]` Goals + targets per metric with progress rings
- [ ] `[S]` Daily/weekly summary digest — a generated "your day" recap
- [ ] `[S]` Customizable dashboard layout — pick which tiles show on overview
- [ ] `[S]` Streaks + reminders across all subsystems

## Parity
~50% of Apple Health's feature surface. The unified-aggregation idea is strong — it genuinely stitches fitness, sleep, mood, journal, and achievements into one surface — but it shows mostly current values without trend charts, cross-metric correlation, or wearable import.
