# mental-health — Feature Gap vs Daylio / Finch / Wysa

Category leader (2026): Daylio (mood journaling) + Finch (wellness companion). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/mentalhealth.js` — ~29 macros: moodTracker, copingStrategies, wellnessScore, journalPrompt, crisis-hotlines, cdc-mental-health-stats, session log/history/stats, mindfulness-minutes, course CRUD, mood log/history/insights, breathing patterns/log/stats, sleep log/history, gratitude add/list, goal set/status, wellness-dashboard.

## Has (verified in code)
- Mood tracking — mood log/history, trend/variance analysis, mood insights
- Journaling — journal prompts mood-adaptive, journal entries with sentiment + tags
- Coping strategies — trigger-matched suggestions; wellness scoring (sleep/exercise/social/mood)
- CBT-style courses — course create/list/detail/complete-session
- Breathing exercises — patterns, breathing log + stats
- Sleep tracking — sleep log/history; gratitude practice; goal setting + status
- Crisis support — crisis-hotline directory, CrisisPanel; CDC mental-health stats; wellness dashboard; MedlinePlus panel

## Missing — buildable feature backlog
- [x] `[M]` Conversational AI check-in companion — supportive chat (Wysa-style) with the cognitive brain
- [x] `[M]` Custom mood factors / activity tags — user-defined trackable factors (Daylio core)
- [x] `[M]` Correlation insights — surface which activities correlate with better mood
- [x] `[S]` Mood calendar / year-in-pixels visualization
- [x] `[S]` Reminders for check-ins, breathing, and gratitude
- [x] `[M]` Guided CBT/DBT exercise modules — thought records, cognitive reframing worksheets
- [x] `[S]` Export / shareable report for a therapist
- [x] `[M]` Safety plan builder — personalized crisis coping plan

## Parity
~95% of the Daylio/Finch surface. Mood, journal, breathing, sleep, gratitude, goals, courses, crisis resources plus a conversational check-in companion, custom mood factors, correlation insights, a year-in-pixels calendar, reminders, CBT/DBT worksheets, a therapist report export, and a safety-plan builder all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
