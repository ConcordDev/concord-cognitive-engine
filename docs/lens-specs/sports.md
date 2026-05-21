# sports — Feature Gap vs ESPN

Category leader (2026): ESPN. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `sports` domain (8 macros). Pure-compute analytics (performance stats, training plan, injury risk, team analysis) + live TheSportsDB team/league/fixture lookup + ESPN public scoreboard.

## Has (verified in code)
- Live team lookup via TheSportsDB (badge, stadium, league, founded)
- ESPN public scoreboard integration for live scores
- Performance-stat analyzer (trend, consistency, recent form)
- Training-plan generator (sport/level/days), injury-risk model, roster/team analysis
- Deep 1000-line UI

## Missing — buildable feature backlog
- [ ] `[M]` Live game detail / play-by-play view — scoreboard exists but no per-game drill-down
- [ ] `[M]` League standings tables and schedules
- [ ] `[M]` Follow teams / personalized "My Teams" feed with score notifications
- [ ] `[M]` Player profiles, rosters, and season stat lines from TheSportsDB
- [ ] `[S]` News / headlines feed (free RSS or ESPN news API)
- [ ] `[M]` Fantasy / pick'em / bracket features
- [ ] `[S]` Sport / league filter and search across the scoreboard
- [ ] `[M]` Game reminders + calendar of upcoming fixtures
- [ ] `[L]` Live win-probability / advanced analytics overlays

## Parity
~45% of ESPN. Live scores and team lookup are wired and the personal-coaching analytics are a genuine extra, but the spectator core — standings, schedules, following teams, player pages, play-by-play — is largely absent.
