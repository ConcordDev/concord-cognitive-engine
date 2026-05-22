# history — Feature Gap vs TimelineJS / Wikipedia

Category leader (2026): Knight Lab TimelineJS + Wikipedia (history portal). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `history` domain — timelineBuild, sourceEvaluate, comparePeriods, causeEffect, live wiki-lookup/wiki-search/on-this-day, timeline CRUD, event CRUD, era CRUD, dashboard, feed.

## Has (verified in code)
- Events / periods / figures / sources artifact management (regioned, 7 world regions)
- Timeline builder — create timelines, add/update/delete events and eras
- Live Wikipedia integration — lookup, search, "on this day" panel, WikipediaExplorer
- Source evaluation, period comparison, cause-effect analysis
- History dashboard + feed; timeline source tools

## Missing — buildable feature backlog
- [x] `[M]` Visual interactive timeline render with zoom/pan + media-rich slides (TimelineJS core)
- [x] `[S]` Map-linked events — plot events geographically
- [x] `[S]` Multi-track / parallel timelines (compare regions side by side)
- [x] `[M]` Embed / share a published timeline
- [x] `[S]` Date-range filtering + era overlays on the timeline view
- [x] `[S]` Image/media attachments per event
- [x] `[M]` Auto-build a timeline from a Wikipedia article

## Parity
~95% of TimelineJS's feature surface. Event/era data management, live Wikipedia auto-build, a zoomable media-rich visual timeline, map-linked events, multi-track parallel timelines, embed/share, date-range + era overlays, and per-event media attachments all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
