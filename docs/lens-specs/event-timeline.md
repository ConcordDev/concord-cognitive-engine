# event-timeline — Feature Gap vs activity-feed / audit-log viewers

Category leader (2026): no direct consumer rival — internal substrate utility. Closest analog: a system activity feed / audit-log viewer (Datadog Events, a Slack activity stream). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `event_timeline` domain macros via `/api/lens/run` — recent (paged feed), stats (per-channel counts last 24h); OnThisDay component.

## Has (verified in code)
- Paged substrate event feed (event_timeline.recent)
- Per-channel event counts over the last 24h (event_timeline.stats)
- "On this day" historical event recall

## Missing — buildable feature backlog
- [ ] `[S]` Channel/type filter — show only selected event channels
- [ ] `[S]` Full-text search across events
- [ ] `[S]` Date-range picker — view events for an arbitrary window
- [ ] `[M]` Event detail drill-in — expand a row to see full payload and linked entities
- [ ] `[S]` Live tail mode — stream new events in real time
- [ ] `[S]` Per-channel trend sparkline (stats are point-counts; needs a time series)
- [ ] `[S]` Export filtered events to CSV/JSON

## Parity
~40% of an activity-feed viewer. The paged feed + 24h stats + on-this-day are a real read surface, but missing the channel filter, search, date-range, and detail drill-in that make an event log investigable.
