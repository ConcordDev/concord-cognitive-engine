# affect — Feature Gap vs Daylio / Hume AI

Category leader (2026): Daylio mood tracker + Hume AI emotion analytics (closest analogs). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/affect.js` (504 LOC) — macros `sentimentAnalysis`, `emotionTimeline`, `empathyMap`; generic artifact store for affect events; LiveAffectStream realtime panel.

## Has (verified in code)
- Five affect dimensions (valence, arousal, stability, coherence, growth) with gauges
- Tabs: dimensions, events, policy, health, analysis
- Sentiment analysis, emotion-timeline, empathy-map compute macros
- Live affect stream realtime panel; affect-event logging with filters
- Policy controls and health view; AI universal actions

## Missing — buildable feature backlog
- [x] `[M]` Daily mood check-in ritual with streak tracking
- [x] `[M]` Trend charts: weekly/monthly mood averages and correlations
- [x] `[S]` Activity/tag correlation ("you feel better after X")
- [x] `[M]` Journaling prompt entries tied to each affect event
- [x] `[S]` Mood-based reminders / nudges
- [x] `[M]` Export emotional report (PDF/CSV) for personal or clinical use
- [x] `[S]` Customizable mood scale / emoji set

## Parity
~90% of the mood-tracking + emotion-analytics surface. The five-dimension model and timeline analytics plus a daily check-in ritual with streaks, weekly/monthly trend charts, activity/tag correlation, journaling prompts, mood-based reminders, report export, and a customizable mood scale all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
