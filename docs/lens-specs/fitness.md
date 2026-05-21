# fitness — Feature Gap vs Strava / Garmin Connect

Category leader (2026): Strava / Garmin Connect. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `fitness` domain — deep macro suite: workout logging, HR zones, recovery, activity summary, AI workout plan, activities + kudos, segments + leaderboards, routes, training load, race predictor, HRV, training readiness, body battery, PRs, gear, clubs, challenges, dashboard, feed.

## Has (verified in code)
- Activity logging with kudos; segments + segment efforts + leaderboards; route builder
- HR zones, HRV log/status, training readiness, body battery, training load, recovery history
- Race predictor, personal records, gear tracking with retirement, activity rings
- Clubs (create/join), challenges (create/join); workout planner + AI plan generation
- Coaching mode: clients/programs/workouts/classes/teams/recruiting tabs; activity feed

## Missing — buildable feature backlog
- [ ] `[L]` GPS activity recording (live tracking) + GPX import from devices
- [ ] `[M]` Wearable sync (Apple Health / Garmin / Fitbit) for HR/sleep/steps auto-ingest
- [ ] `[M]` Map-based activity heatmap + segment explore on a real map
- [ ] `[S]` Photo attachments + activity comments thread
- [ ] `[M]` Live segment / live activity sharing ("Beacon")
- [ ] `[S]` Training plan calendar with adaptive rescheduling
- [ ] `[S]` Relative effort / fitness-and-freshness trend chart

## Parity
~65% of Strava's feature surface. The analytics depth (segments, training load, HRV, race predictor, body battery) rivals Garmin, but it lacks live GPS recording, wearable sync, and the map-centric social discovery that anchor Strava — activities must be entered, not captured.
