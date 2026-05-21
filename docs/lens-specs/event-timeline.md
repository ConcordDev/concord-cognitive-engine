# event-timeline — Feature Gap vs activity-feed / audit-log viewers

Category leader (2026): no direct consumer rival — internal substrate utility. Closest analog: a system activity feed / audit-log viewer (Datadog Events, a Slack activity stream). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `event_timeline` domain macros via `/api/lens/run` — recent (paged feed), stats (per-channel counts last 24h); OnThisDay component.

## Has (verified in code)
- Paged substrate event feed (event_timeline.recent)
- Per-channel event counts over the last 24h (event_timeline.stats)
- "On this day" historical event recall

## Missing — buildable feature backlog
- [x] `[S]` Channel/type filter — show only selected event channels (category toggles + exact-channel chips driven by `event_timeline.channels`)
- [x] `[S]` Full-text search across events (`event_timeline.search` — channel + payload + actor)
- [x] `[S]` Date-range picker — view events for an arbitrary window (`event_timeline.range`)
- [x] `[M]` Event detail drill-in — expand a row to see full payload and linked entities (`EventDetailPanel` via `event_timeline.detail` — payload, linked entity refs, ±30s nearby events)
- [x] `[S]` Live tail mode — stream new events in real time (5s poll with pause/resume)
- [x] `[S]` Per-channel trend sparkline (`ChannelTrends` + `Sparkline` via `event_timeline.timeseries`)
- [x] `[S]` Export filtered events to CSV/JSON (`event_timeline.exportEvents` → blob download)

Also shipped: per-user saved filter presets (`event_timeline.saveView` / `listViews` / `deleteView`).

## Parity
~90% of an activity-feed viewer. The paged feed + 24h stats + on-this-day are joined by channel filtering, full-text search, date-range queries, event detail drill-in, live-tail pause, trend sparklines, CSV/JSON export, and saved filter views — a fully investigable event log.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
