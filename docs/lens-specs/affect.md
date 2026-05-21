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
- [ ] `[M]` Daily mood check-in ritual with streak tracking
- [ ] `[M]` Trend charts: weekly/monthly mood averages and correlations
- [ ] `[S]` Activity/tag correlation ("you feel better after X")
- [ ] `[M]` Journaling prompt entries tied to each affect event
- [ ] `[S]` Mood-based reminders / nudges
- [ ] `[M]` Export emotional report (PDF/CSV) for personal or clinical use
- [ ] `[S]` Customizable mood scale / emoji set

## Parity
~55% of the mood-tracking + emotion-analytics surface. The five-dimension model and timeline analytics are sophisticated, but it lacks the habit-loop (daily check-in, streaks) and correlation insights that make consumer mood apps sticky.
