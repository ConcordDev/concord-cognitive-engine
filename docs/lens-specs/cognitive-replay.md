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
- [ ] `[S]` Aggregate stats: total tokens, top brain, busiest day, sessions count
- [ ] `[M]` Filter timeline by brain / tool / session / date range
- [ ] `[S]` Wrapped-style summary cards ("your week in cognition")
- [ ] `[M]` Heatmap / calendar view of activity intensity
- [ ] `[S]` Click an event → jump to that conversation
- [ ] `[S]` Compare two time windows
- [ ] `[S]` Shareable replay snapshot

## Parity
~48% of a personal-timeline scrubber. The core scrub-and-inspect interaction is real and the data is rich, but it lacks the aggregate stats, filtering, and Wrapped-style summary that make a timeline app engaging.
