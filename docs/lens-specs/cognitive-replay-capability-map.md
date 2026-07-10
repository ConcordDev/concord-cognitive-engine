# cognitive-replay — capability map (Frontend Rebuild Program, Wave 3)

Reference apps: **Spotify Wrapped** (annual/periodic personalized-stats
cards) and **RescueTime** (activity timeline scrubber, heatmap, window-vs-
window comparison, shareable reports). Parity target: the only difference
should be that the underlying activity is a user's cognitive/chat session
history rather than app-usage telemetry.

## Backend macro surface

`cognitive-replay` domain — **10 macros**: `stats`, `filter`, `wrapped`,
`heatmap`, `event`, `compare`, `snapshot-create`, `snapshot-list`,
`snapshot-get`, `snapshot-delete`. The base scrubber additionally reads
`chat.timeline` for the raw turn-by-turn event stream.

`node scripts/lens-unsurfaced.mjs --lens cognitive-replay` → **0/10
unsurfaced**, unchanged by this audit.

## Audit finding: already comprehensive, no gaps

The page implements all four explicit UX states (loading/error/empty/
populated) over the real `chat.timeline` feed, with an honest distinction
between a swallowed fetch failure and a genuinely empty timeline (a
`role="alert"` + working Retry, not a silent blank page). On top of the
scrubber:

- **Wrapped** → `WrappedCards.tsx` (`cognitive-replay.wrapped`) — the
  Spotify-Wrapped-shaped personalized stat cards.
- **Heatmap** → `ActivityHeatmap.tsx` (`cognitive-replay.heatmap`).
- **Filter** → `FilteredTimeline.tsx` (`cognitive-replay.filter`), with
  jump-to-event wired through `EventDetailModal.tsx`
  (`cognitive-replay.event`).
- **Compare** → `WindowCompare.tsx` (`cognitive-replay.compare`) — real
  window-vs-window comparison, the RescueTime-shaped feature.
- **Snapshots** → `SnapshotPanel.tsx` (`snapshot-create`/`snapshot-list`/
  `snapshot-delete`), plus a real shareable-link path: the page reads a
  `?snapshot=<id>` URL param and resolves it via `snapshot-get`, rendering
  a "Shared snapshot" banner with the snapshot's own frozen stats — a
  genuine share-and-view flow, not a stub link.
- **Export** → `TimelineExport.tsx`.
- A per-brain aggregate stats bar (`StatsBar.tsx`, `cognitive-replay.stats`)
  sits above the tabs, range-scoped (7/14/30/90 days).

No fabricated data found in the 8 audited components (`ActivityHeatmap`,
`EventDetailModal`, `FilteredTimeline`, `SnapshotPanel`, `StatsBar`,
`TimelineExport`, `WindowCompare`, `WrappedCards`) — every value traces to
one of the 10 macros above or the `chat.timeline` feed.

## What this rebuild changed

Nothing. The audit found a genuinely complete lens with 100% macro
coverage through real, purpose-built UI, a working share-link flow, and no
generic action arrays. Per the program's honesty rule, an audit that finds
nothing wrong says so rather than inventing a diff.

## Disposition ledger (step 1.5)

- **ALREADY REAL**: all 10 `cognitive-replay` macros; the `chat.timeline`
  scrubber; the share-link resolve flow (`?snapshot=<id>` → `snapshot-get`).
- **BACKEND-CAPABLE-BUT-UNSURFACED**: none found.
- **GENUINELY MISSING**: none against the Wrapped/RescueTime parity
  checklist (personalized stat cards ✓, activity heatmap ✓, timeline
  filter + jump-to-event ✓, window comparison ✓, export ✓, shareable
  snapshot ✓).

## Verification

- Confirmed via read-only audit; no files touched.
- `node scripts/verify-lens-backends.mjs` — `cognitive-replay` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `cognitive-replay`:
  `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens cognitive-replay` — 0/10 unsurfaced.
