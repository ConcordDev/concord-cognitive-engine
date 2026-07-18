# History Lens — Capability Map (Wave 2 Rebuild)

> Derived, not asserted. Every macro below was enumerated by grepping
> `server/domains/history.js` (745 LOC), `server/domains/free-api-live.js`,
> and `server/domains/wikipedia-search.js` for `registerLensAction("history"`
> and `register("history"`. Frontend callers were confirmed by grepping
> `concord-frontend/` for each macro's literal action string.
>
> Reproduce the macro list:
> `grep -nE 'registerLensAction\("history"|register\("history"' server/domains/history.js server/domains/free-api-live.js server/domains/wikipedia-search.js`

## Step 1.5 — reference-parity checklist (mandatory, per `docs/FRONTEND_REBUILD_PROGRAM.md`)

**(a) Reference apps.** Two real best-in-class references for this domain's
actual capability shape:
1. **[TimelineJS](https://timeline.knightlab.com/)** (Knight Lab) — the
   real, widely-used open-source journalism/history timeline tool. Chosen
   because the backend substrate (`timeline-create/list/detail`,
   `event-add/update/delete`, `era-add/delete`, `event-set-location`,
   `event-add-media`, `timeline-render`, `timeline-compare`,
   `timeline-publish`) is genuinely TimelineJS-shaped: dated events,
   color-coded era overlays, per-event media, map-linked events, multi-track
   parallel comparison, and a publish/embed flow. This is not an analogy —
   the backend's own code comments and this file's structure already call
   it "TimelineJS-shape."
2. **Wikipedia itself** (article pages + the "On This Day" portal) — because
   that IS the lens's real external data source (`wiki-lookup`,
   `wiki-search`, `on-this-day` hit the live Wikipedia REST API with no
   fabrication layer in between).

**(b) Parity target** (owner's framing): *the only difference between this
lens and TimelineJS + Wikipedia should be that Concord's timelines are
generated from live Wikipedia data (or user-authored) and live inside a
substrate with citation/DTU/royalty plumbing — nothing else.* Feature-for-
feature, a Concord timeline should do what a TimelineJS timeline does; a
Concord Wikipedia lookup should do what reading Wikipedia does, plus honest
save/cite/publish hooks TimelineJS/Wikipedia don't have.

**(c) Researched checklist** (TimelineJS's documented feature set + Wikipedia's
documented On-This-Day / search / article surfaces — not an LLM's guess):

| # | Checklist item (TimelineJS / Wikipedia feature) | Disposition |
|---|---|---|
| 1 | Dated events on a navigable axis (BCE supported) | **ALREADY REAL** — `event-add` (`hsYear`, negative = BCE), `VisualTimeline.tsx` zoomable axis |
| 2 | Color-coded era/period overlay bands | **ALREADY REAL** — `era-add`, rendered as translucent bands in `VisualTimeline.tsx` + `TimelineCompare.tsx` |
| 3 | Media-rich event slides (image/video/audio) | **ALREADY REAL** — `event-add-media`/`event-remove-media`, rendered in `VisualTimeline.tsx`'s slide panel |
| 4 | Multiple tracks/categories on one timeline | **ALREADY REAL** — `track` field on events, track filter in `timeline-render`/`VisualTimeline.tsx` |
| 5 | Map-linked events (geographic plotting) | **ALREADY REAL** — `event-set-location` + `map-points`, rendered via `EventMap.tsx` on the shared `MapView` |
| 6 | Zoom / pan / navigate between slides | **ALREADY REAL** — `VisualTimeline.tsx` zoom control + prev/next slide navigation with scroll-into-view |
| 7 | Parallel/compare multiple timelines on one axis | **ALREADY REAL** — `timeline-compare` (up to 6), `TimelineCompare.tsx` |
| 8 | Publish + embeddable share link | **ALREADY REAL** — `timeline-publish`/`timeline-unpublish`/`timeline-public-get`, `TimelinePublish.tsx` (share URL + `<iframe>` embed code) |
| 9 | Auto-generate a timeline from a source document | **ALREADY REAL** — `timeline-from-wikipedia` (deterministic year-sentence extraction from the live article, no LLM), `WikiTimelineImport.tsx` |
| 10 | Full-text Wikipedia article search with typeahead | **ALREADY REAL** — `wiki-search` (opensearch), debounced typeahead in `WikipediaExplorer.tsx` |
| 11 | Article reader with hero image, infobox, source link | **ALREADY REAL** — `wiki-lookup`, `ArticleReader` in `WikipediaExplorer.tsx` |
| 12 | "On This Day" — events/births/deaths/holidays by date | **ALREADY REAL** — `on-this-day`, date-picker + tabs in `WikipediaExplorer.tsx`'s `OnThisDay` |
| 13 | "On This Day" — featured/selected picks (Wikipedia's own "Selected anniversaries") | **BACKEND-CAPABLE-BUT-UNSURFACED → NOW WIRED** — `on-this-day` already supports `kind:"selected"`; the frontend never passed it (only events/births/deaths/holidays tabs existed, and a separate duplicate component `WikipediaOnThisDayPanel.tsx` had the Featured tab wired to a *different* backend macro). Closed in this rebuild by adding a Featured tab to `WikipediaExplorer.tsx`'s `OnThisDay` using `kind:"selected"` — see "Wikipedia surface consolidation" below. |
| 14 | Save / cite a fact with source attribution | **ALREADY REAL** — `SaveAsDtuButton` on every article/On-This-Day card + `HistoryArticleActions`'s Cite pane (mints a citation DTU with source URL) |
| 15 | Reliability/credibility assessment of a source | **ALREADY REAL** — `sourceEvaluate` (type/bias/author/date-weighted score), `TimelineSourceTools.tsx` |
| 16 | Cross-period / cross-era comparison (duration, shared traits) | **was UNSURFACED → NOW WIRED** — `comparePeriods` had zero frontend callers (confirmed by grep); now surfaced in the new `PeriodCauseEffectTools.tsx` |
| 17 | Causal-chain / "what led to what" mapping | **was UNSURFACED → NOW WIRED** — `causeEffect` had zero frontend callers; now surfaced alongside `comparePeriods` in `PeriodCauseEffectTools.tsx` |
| 18 | Aggregate personal stats (how many timelines/events authored) | **was UNSURFACED → NOW WIRED** — `history-dashboard` had zero frontend callers; now the header `HistoryDashboardStrip.tsx` |
| 19 | Bulk ingestion of "today in history" as reusable records | **ALREADY REAL** — `feed` macro (ingests Wikimedia On-This-Day events as DTUs), `LensFeedButton` |
| 20 | Notable-person/biography tracking distinct from dated events | ~~**GENUINELY MISSING (backend)**~~ **CLOSED (2026-07-16, `bc0ba5e6`).** `server/domains/history.js` gained a real `history.figure-*` macro family — `figure-add`/`figure-list`/`figure-update`/`figure-delete`/`figure-link-event`/`figure-unlink-event` — modeled directly on this file's own `timeline-create`/`event-add`/`era-add` shape (`STATE.historyLens`, shared `hsClean`/`hsId`/`hsNow`/`hsActor`/`hsYear` helpers, same per-user Map substrate as timelines). The genuine differentiator this row itself named — "timeline-linkage" — is real, not decorative: `figure-link-event` validates `timelineId`/`eventId` against the caller's actual timeline/event data via the existing `findTimeline` helper (a fabricated id is rejected with an honest `timeline not found`/`event not found`, never silently accepted), and `figure-list`/`figure-update` re-derive every linked event LIVE on every read — a since-deleted timeline or event surfaces honestly as `found:false` rather than vanishing or staying falsely "valid" (the same live-rederivation-honesty pattern this session's masonry/landscaping/plumbing units established for job/dispatch linkage). `figure-update` is a genuine partial update (empty/omitted fields leave existing values untouched). `FiguresNotebook.tsx` is rewired off the generic disconnected `useLensData('history','Figure')` store onto these real macros (via the same `lensRun` helper every sibling history component already uses), with a real event-linkage UI in the detail panel — a linked-events list with an honest "no longer exists" indicator, unlink, and a link picker sourced entirely from real `timeline-list`/`timeline-detail` calls (no fabricated options) — and the old "not backend-validated or scored" disclosure banner replaced with an accurate one that owns the real value (persistence + validated linkage) while still honestly noting there's no figure-analysis/scoring capability yet. Tests: 19 new behavioral cases in `server/tests/depth/history-figures-behavior.test.js` (CRUD round-trip, validation rejections, per-user isolation, link/unlink success + rejection of a fabricated timeline/event id + dedupe on double-link, and the core live-rederivation honesty case — link an event, delete its timeline, confirm the figure survives with `found:false`) plus 9 new cases in `concord-frontend/tests/components/FiguresNotebook.test.tsx` (render, banner honesty, create/update/delete, both `found:true`/`found:false` rendering, unlink, full link-picker flow). All 65 pre-existing history tests still pass alongside the new ones (84/84 combined, 0 regressions). |

**(d) Coverage:** 20 of 20 checklist items are ALREADY REAL or now WIRED
after this rebuild plus the 2026-07-16 figure-linkage build (was 16/20 at
the original rebuild — items 13, 16, 17, 18 were dead or unsurfaced; item
20 was honestly deferred, now closed). **100% reference-checklist coverage.**

---

## The Group A / Group B conflict — how it was resolved

The rebuild brief's audit was correct: the old page's primary surface (tabs
"Events / Periods / Figures / Sources / Dashboard") was a **generic,
domain-agnostic per-user artifact notebook** (`useLensData('history',
'Event'|'Period'|'Figure'|'Source')`, the same mechanism every scaffold lens
uses with history-flavored type names) with **zero connection** to any of
the 25 macros registered in `history.js`. Its one "Zap → run AI analysis"
button called the generic `lens.run` macro with `action:"analyze"`; since
`history` has no `registerLensAction("history","analyze",...)`, that request
always fell through to the last-resort AI catch-all in `server.js`
(`LENS_ACTIONS.get('history.analyze')` misses → routes to the utility brain
with no domain-specific prompt) — a real LLM call, but generic and
undesigned, not a designed history feature.

Meanwhile the REAL, STATE-backed timeline substrate (Group B — 17 macros:
`timeline-create/list/detail/delete`, `event-add/update/delete`,
`era-add/delete`, `event-set-location`, `map-points`, `event-add-media/
remove-media`, `timeline-render`, `timeline-compare`, `timeline-publish/
unpublish/public-get`, `timeline-from-wikipedia`, `history-dashboard`) was
already largely composited into a genuinely good, TimelineJS-parity tool
(`TimelineBuilder.tsx` + 6 sub-components) but was rendered at the very
bottom of the page, below the fold, after the fake-primary tab system.

**Resolution — audited macro-by-macro, not a blanket delete:**

| Old Group A type | Verdict | Why |
|---|---|---|
| **Event** | **RETIRED**, superseded | The real Timeline Events (Group B) are strictly richer — dated (BCE-aware), categorized, tracked, geo-located, media-attached, and actually render on a real timeline. Keeping a second, disconnected "Event" concept with no macro backing would be the exact two-parallel-systems confusion the audit flagged. Users author events inside **Timelines** now. |
| **Period** | **RETIRED**, superseded | `comparePeriods` was sitting UNSURFACED with a data shape (`name/startYear/endYear/features/population/technology/governance`) that maps directly onto what the old Period notebook stored, except the notebook never called the macro. Rather than keep an un-analyzed notebook AND separately wire the macro, one real analyzer tool does both: **`PeriodCauseEffectTools.tsx`** (Analysis Tools tab). |
| **Source** | **RETIRED**, superseded | `sourceEvaluate` already had a real, working, designed surface (`TimelineSourceTools.tsx`) computing an actual reliability score. A parallel "notebook of sources with no evaluation" would be strictly worse than "evaluate a source (and optionally save the evaluation as a DTU)." No functionality lost — the evaluator's input fields are a superset of what the notebook stored. |
| **Figure** | **KEPT**, honestly rescoped | No macro in the domain's 28-macro surface models a historical person. This is the one type with no better real home. Rebuilt as `FiguresNotebook.tsx` — real per-user persistence (not fake data; genuinely saved via `/api/lens/history`), explicitly labeled in-UI as "personal notes... not backend-validated or scored" so it never masquerades as a designed, macro-analyzed feature. This satisfies the brief's "don't just delete real user data functionality" instruction while not letting a disconnected tab stay framed as the lens's identity. |

**Net effect:** every one of the 4 old generic-notebook types was audited on
its own merits. Three were upgraded into real, macro-backed, DESIGNED tools
(closing 3 previously-dead macros in the process); one was kept exactly
because it had nowhere better to go, and is now honestly labeled instead of
silently pretending to be analyzed. The flagship identity of the lens is now
**Timelines** (Group B), not the old fake-primary tab system.

---

## Backend surface — full macro enumeration

### `server/domains/history.js` (25 macros)

| Macro | Real result shape (key fields) | Classification |
|---|---|---|
| `timelineBuild` | `{timeline[], totalEvents, timeSpan, categories[], eras[], pivotalEvents[]}` | **DESIGNED** — `TimelineSourceTools.tsx` (Analysis Tools) |
| `sourceEvaluate` | `{reliabilityScore, classification, corroborationNeeded, evaluation{...}}` | **DESIGNED** — `TimelineSourceTools.tsx` |
| `comparePeriods` | `{periods[], longestPeriod, shortestPeriod, sharedFeatures[]}` | **was UNSURFACED → NOW DESIGNED** — `PeriodCauseEffectTools.tsx` (new) |
| `causeEffect` | `{chains[], totalLinks, directCauses, indirectCauses, strongLinks, rootCauses[]}` | **was UNSURFACED → NOW DESIGNED** — `PeriodCauseEffectTools.tsx` (new) |
| `wiki-lookup` | `{title, extract, thumbnail, pageUrl, lang, ...}` | **DESIGNED** — `WikipediaExplorer.tsx` `ArticleReader` |
| `wiki-search` | `{results[]{title,description,url}, count}` | **DESIGNED** — `WikipediaExplorer.tsx` typeahead |
| `on-this-day` | `{events[]/births[]/deaths[]/holidays[]/selected[]}` per `kind` | **DESIGNED** — `WikipediaExplorer.tsx` `OnThisDay` (now incl. Featured/`selected`) |
| `timeline-create` | `{timeline{id,title,description,events:[],eras:[]}}` | **DESIGNED** — `TimelineBuilder.tsx` |
| `timeline-list` | `{timelines[]{id,title,eventCount,eraCount}, count}` | **DESIGNED** — `TimelineBuilder.tsx` picker |
| `timeline-detail` | `{timeline{...events,eras}, span}` | **DESIGNED** — `TimelineBuilder.tsx` |
| `timeline-delete` | `{deleted}` | **DESIGNED** — `TimelineBuilder.tsx` |
| `event-add` | `{event}` | **DESIGNED** — `TimelineBuilder.tsx` (now with pending-state feedback) |
| `event-update` | `{event}` | **DESIGNED** — delegate path used by media/location editors |
| `event-delete` | `{deleted}` | **DESIGNED** — `TimelineBuilder.tsx` |
| `era-add` | `{era}` | **DESIGNED** — `TimelineBuilder.tsx` (now with pending-state feedback) |
| `era-delete` | `{deleted}` | **DESIGNED** — `TimelineBuilder.tsx` |
| `event-set-location` | `{event}` | **DESIGNED** — `EventMap.tsx` |
| `map-points` | `{points[], count}` | **DESIGNED** — `EventMap.tsx` on shared `MapView` |
| `event-add-media` | `{media, event}` | **DESIGNED** — `EventMediaManager.tsx` |
| `event-remove-media` | `{deleted, event}` | **DESIGNED** — `EventMediaManager.tsx` |
| `timeline-render` | `{events[], eras[], tracks[], categories[], span, range}` | **DESIGNED** — `VisualTimeline.tsx` |
| `timeline-compare` | `{tracks[], combinedSpan, trackCount}` | **DESIGNED** — `TimelineCompare.tsx` |
| `timeline-publish` | `{shareId, shareUrl, embedCode, eventCount}` | **DESIGNED** — `TimelinePublish.tsx` |
| `timeline-unpublish` | `{unpublished}` | **DESIGNED** — `TimelinePublish.tsx` |
| `timeline-public-get` | `{shareId, title, events[], eras[]}` | **DESIGNED** — public read path behind `shareUrl` (no owner scoping, by design) |
| `timeline-from-wikipedia` | `{timeline{...}, extractedCount, usedCount}` | **DESIGNED** — `WikiTimelineImport.tsx` |
| `history-dashboard` | `{timelines, totalEvents, totalEras, publishedTimelines, mappedEvents}` | **was UNSURFACED → NOW DESIGNED** — `HistoryDashboardStrip.tsx` (new, page header) |
| `feed` | `{ingested, skipped, source, dtuIds[]}` | **DESIGNED** — `LensFeedButton` (Wikipedia Research tab) |

### `server/domains/free-api-live.js` + `server/domains/wikipedia-search.js` (3 macros)

| Macro | Reality | Classification |
|---|---|---|
| `live_wiki_otd` | Real Wikipedia On-This-Day fetch — a **second, independent implementation** of the same concept as `on-this-day` above (different endpoint shape: `/feed/v1/.../onthisday/all/mm/dd` vs. per-kind `/feed/onthisday/{kind}/mm/dd`). Previously surfaced only via the standalone `WikipediaOnThisDayPanel.tsx`, which duplicated `WikipediaExplorer.tsx`'s own On-This-Day mode feature-for-feature except for the Featured tab. | **Backend duplication — documented, not fixed (out of scope for this frontend-only rebuild).** UI resolution: not mounted in the rebuilt page; `WikipediaExplorer.tsx`'s `on-this-day`-backed surface was extended with the one feature (Featured/`selected`) this duplicate had that the other lacked, so nothing is lost and there is exactly one Wikipedia On-This-Day surface in the lens now. `WikipediaOnThisDayPanel.tsx` is left on disk untouched (not deleted — retiring a component from this lens doesn't warrant deleting the file, and it is a real, working, independently-correct component if another page ever wants it). |
| `live_wiki_search` | Real Wikipedia opensearch + summary join — registered generically across 10 lenses (`history` among them) by `wikipedia-search.js`. A second, independent implementation of the same concept as `wiki-search`+`wiki-lookup`. | **Backend duplication — documented, not fixed.** UI resolution: `WikipediaExplorer.tsx`'s `ArticleSearch` (backed by `wiki-search`/`wiki-lookup`) is strictly richer than the generic `WikipediaSearchPanel.tsx` (backed by `live_wiki_search`) — it has an infobox sidebar, revision timestamp, and the full `HistoryArticleActions` cite/DM/study-guide/publish/connect panel that the generic shared panel doesn't. The generic panel is **not mounted** in the rebuilt history page (it remains mounted, untouched, read-only, in the 6 other lenses that use it — `desert`, `philosophy`, `neuro`, `ocean`, `geology`, `space` — none of which have a richer alternative the way history does). |
| `live_wiki_summary` | Real single-article summary, registered alongside `live_wiki_search`. | **Backend duplication of `wiki-lookup` — documented, not fixed.** Not called from this lens's UI (superseded by `wiki-lookup`, same reasoning as above). |

These three live in generic multi-lens files (`free-api-live.js`,
`wikipedia-search.js`) shared with 9 other lenses — editing or removing them
is backend work outside this rebuild's file scope
(`concord-frontend/app/lenses/history/`,
`concord-frontend/components/history/`). Recorded here per the step-1.5
"no silent gaps" rule rather than left undocumented.

---

## Real bug found and fixed in the process

`WikipediaExplorer.tsx`'s `OnThisDay` component picked which result array to
render with `r.events || r.births || r.deaths || r.holidays || r.selected ||
[]`. The `on-this-day` macro only populates the field matching the
requested `kind` (Wikipedia's REST endpoint is itself per-kind); the other
four fields come back as `[]` — and `[]` is **truthy** in JavaScript, so the
`||` chain always resolved to whichever field is checked first. In practice
this meant the Births/Deaths/Holidays tabs (and now Featured) were
**permanently empty** regardless of the actual selected tab, because
`r.events` (checked first) is `[]`-but-truthy on every non-`events` request.
Fixed with a keyed lookup by the actual requested `kind` instead of `||`
chaining. Not part of the original brief — found by reading the component
closely while wiring the new Featured tab, and fixed because leaving a known
dead tab in a rebuilt "no-air" lens would violate the honesty rule.

---

## What was built (files touched)

- `concord-frontend/app/lenses/history/page.tsx` — full rewrite. 4-tab
  workspace (Timelines / Wikipedia Research / Analysis Tools / Figures
  Notebook), real header dashboard strip, density toggle, scoped keyboard
  commands (1-4 to switch tabs).
- `concord-frontend/components/history/HistoryDashboardStrip.tsx` (new) —
  wires the previously-dead `history-dashboard` macro via
  `useMacroDispatchFeedback` (real pending/error/success states on the
  refresh control itself).
- `concord-frontend/components/history/PeriodCauseEffectTools.tsx` (new) —
  wires `comparePeriods` + `causeEffect`, the two remaining UNSURFACED
  macros, using the existing `CalcPanel` primitive (same shell as
  `TimelineSourceTools.tsx`).
- `concord-frontend/components/history/FiguresNotebook.tsx` (new) — the
  honestly-rescoped personal Figures notebook: `DataTable` master list +
  inspector detail panel, autosaving notes editor with real save-state
  feedback, explicit in-UI disclosure that it is not backend-analyzed.
- `concord-frontend/components/history/WikipediaExplorer.tsx` (edited) —
  added the Featured/`selected` On-This-Day tab (closing the gap vs. the
  now-unmounted `WikipediaOnThisDayPanel.tsx`) and fixed the `||`-chaining
  result-selection bug described above.
- `concord-frontend/components/history/TimelineBuilder.tsx` (edited) —
  added real macro-dispatch pending states (disabled + spinner) to
  Create-timeline / Add-event / Add-era, the three controls that previously
  gave no feedback between click and response.
- `docs/lens-specs/history-capability-map.md` (this file).

**Untouched, reused as-is:** `VisualTimeline.tsx`, `EventMap.tsx`,
`TimelineCompare.tsx`, `TimelinePublish.tsx`, `EventMediaManager.tsx`,
`WikiTimelineImport.tsx`, `HistoryArticleActions.tsx`,
`TimelineSourceTools.tsx` — all already real, already designed, reused
per CLAUDE.md's reuse-first discipline. `WikipediaOnThisDayPanel.tsx` and
`components/wiki/WikipediaSearchPanel.tsx` are left on disk, unmodified,
just not mounted from this page (the latter is shared with 6 other lenses
and must not change behavior for them — confirmed unmodified by diff).

## Density

`DensityToggle` (dropdown variant) sits in the page header and drives the
Figures Notebook's `DataTable` (`low`/`medium` → `comfortable`, `high` →
`compact`). Timelines/Wikipedia/Tools are visual-axis, card, and form-based
surfaces respectively — a timeline's zoom/pan and an article reader's prose
column don't have row-height semantics to respond to a density multiplier,
so they intentionally don't wire into it (per `UI_QUALITY_RUBRIC.md` §1:
"if a lens's layout can't sanely respond to density... document why").

## Micro-interactions (rubric §2 — 3-5+ required; 6 implemented)

1. **Dashboard refresh** — `HistoryDashboardStrip`'s refresh button uses
   `useMacroDispatchFeedback`: synchronous spinner on click, real
   `history-dashboard` result or an honest error line, never a fake delay.
2. **Timeline mutations** — Create-timeline / Add-event / Add-era buttons in
   `TimelineBuilder.tsx` now disable + show a spinner glyph for the exact
   duration of their real macro call (previously no feedback at all between
   click and the list re-rendering).
3. **Visual timeline navigation** — `VisualTimeline.tsx`'s zoom controls +
   prev/next slide buttons animate the selected marker and scroll it into
   view; caused by real selection-state changes, not a mount animation.
4. **Wikipedia search + date navigation** — 200ms-debounced typeahead
   (`ArticleSearch`) and the On-This-Day date-picker's prev/today/next
   controls both drive `AnimatePresence`-keyed transitions tied to the
   actual query/date state change.
5. **Figures notebook row select → inspector** — `DataTable` row
   click/keyboard-activate opens the detail panel; the notes field autosaves
   on blur with a real `saving…` → `Saved` transition (`NotesEditor`).
6. **Analysis tools progressive rows** — `PeriodCauseEffectTools.tsx`'s
   period/chain row add/remove buttons reveal and collapse real form rows,
   matching the established pattern in `TimelineSourceTools.tsx`.

## Verification

- `npx eslint` on all 6 touched files: **clean, 0 warnings/errors.**
- `npx tsc --noEmit -p .`: **0 errors** (repo-wide; no history-related
  errors introduced).
- `node scripts/verify-lens-backends.mjs`: **`history` remains WIRED**
  (258/260 WIRED, 2 by-design NO-BACKEND-CALL — `narrative-walk` and
  `ux-suite`, neither is `history`).
- `node scripts/grade-ux-polish.mjs --honest`:
  `history` row — `tier: "polished"`, `isGenericScaffold: false`,
  `usesGenericBody: false`, `importsGenericTrio: false`,
  `bespokeRatio: 0.935`, `antiPatterns: 0`, `honestCapped: false`.
  (Before this rebuild: capped, `isGenericScaffold: true`.)
- `<div onClick>` audit across all 6 touched files: **zero matches** —
  every interactive element is a native `<button>`/`<a>`/`<input>`/`<select>`.
- Existing tests: no dedicated `history`-lens component test file exists
  (`grep -rl` for `lensRun('history'` / `/lenses/history` across
  `concord-frontend/tests/` matches only the lens-manifest smoke list,
  `tests/lens-e2e/lens-list.ts`, which needed no changes). No test broke.

## Honest residuals / deferred

- The 3-way Wikipedia macro duplication (`wiki-*` vs. `live_wiki_*`) is a
  **backend** issue outside this rebuild's file scope; documented above,
  not fixed.
- `FiguresNotebook` has no backend analysis — disclosed in-UI and in this
  doc, not hidden. A real `history.figure-*` macro family is a legitimate
  future scoped build (estimate: 1 migration + ~150 LOC domain file,
  comparable to `era-add`/`era-delete`'s existing shape).
- `WikipediaOnThisDayPanel.tsx` is now unreferenced from any page (its only
  prior mount was the old history page). Left on disk rather than deleted —
  outside this rebuild's file-touch scope and it is a correct, independent
  component that a future lens could still use.
