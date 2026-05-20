# history — Feature Completeness Spec

Rival app(s): Wikipedia, Tiki-Toki, Sutori (2026)
Sources:
- https://en.wikipedia.org/ (article search, on-this-day — live)
- https://www.tiki-toki.com/ (interactive timeline maker — events, color-coded eras/periods)
- Sutori (educational timeline builder)
- Web search 2026-05-20: Tiki-Toki — drag-and-drop dated events, color-coded time periods, categories

## Features

### Reference & analysis (retained)
- [x] Wikipedia article lookup + search (macro: history.wiki-lookup / wiki-search)
- [x] On-this-day (macro: history.on-this-day)
- [x] Timeline build from supplied events (macro: history.timelineBuild)
- [x] Source evaluation (macro: history.sourceEvaluate)
- [x] Period comparison (macro: history.comparePeriods)
- [x] Cause-effect mapping (macro: history.causeEffect)

### Timeline builder (Tiki-Toki shape)
- [x] Create / list / delete timelines (macro: history.timeline-create / timeline-list / timeline-delete)
- [x] Timeline detail — events sorted by year, eras, span (macro: history.timeline-detail)
- [x] Add dated events — BCE supported via negative years, auto BCE labels, categories (macro: history.event-add)
- [x] Update / delete events (macro: history.event-update / event-delete)
- [x] Color-coded eras / periods — add / delete (macro: history.era-add / era-delete)
- [x] History dashboard — timelines, events, eras (macro: history.history-dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| 3D timeline rendering (Tiki-Toki's signature) | a WebGL timeline renderer | a vertical chronological timeline with era bands; the `world` lens carries 3D |
| Embedded media (YouTube/Flickr) per event | media-embed handling | event descriptions + categories; artifact DTUs carry rich media separately |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/history.js` clean. 15 macros
  (7 reference/analysis + 8 timeline-builder substrate).
- 2026-05-20: Tests — `tests/history-timeline-domain-parity.test.js` 8/8 green
  (timeline CRUD + per-user scope / events sorted year incl. BCE + auto-label +
  no-year reject + update/delete / color-coded eras / dashboard / analysis
  macros intact).
- 2026-05-20: Frontend — new `TimelineBuilder` (multi-timeline, vertical
  chronological event rail, color-coded era bands) mounted in the history
  lens page. `npx tsc --noEmit` exit 0.
