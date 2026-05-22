# cognitive-replay — Feature Gap vs Spotify Wrapped / RescueTime timeline

Category leader (2026): no direct consumer rival — closest analog is a personal-activity timeline scrubber (Spotify Wrapped, RescueTime, Apple Screen Time).
Backend: `chat.timeline` macro — per-turn brain activations, token counts, tool calls, DTU citations across recent sessions.

## Has (verified in code)
- Draggable timeline of cognitive events from the last week of sessions
- Per-event detail: brains used (color-coded), tool calls, DTUs cited, token count, content preview
- Scrub slider to inspect substrate state at any point
- TimelineExport component
- Loading/empty states

## Missing — buildable feature backlog
- [x] `[S]` Aggregate stats: total tokens, top brain, busiest day, sessions count
- [x] `[M]` Filter timeline by brain / tool / session / date range
- [x] `[S]` Wrapped-style summary cards ("your week in cognition")
- [x] `[M]` Heatmap / calendar view of activity intensity
- [x] `[S]` Click an event → jump to that conversation
- [x] `[S]` Compare two time windows
- [x] `[S]` Shareable replay snapshot

## Parity
~88% of a personal-timeline scrubber. The core scrub-and-inspect interaction is real and the data is rich, but it lacks the aggregate stats, filtering, and Wrapped-style summary that make a timeline app engaging.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
