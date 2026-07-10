# Event Timeline Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Naming quirk (read this first — it broke the automated tooling for this lens)

The backend file is `server/domains/event-timeline.js` (hyphen, matching the
lens directory), but every macro inside it registers under the domain name
**`event_timeline`** (underscore):

```
grep -n 'register(' server/domains/event-timeline.js
```
→ 11 hits, all `register("event_timeline", "<name>", ...)`.

`scripts/lens-rebuild-backlog.mjs`'s `DOMAIN_TO_LENS_ALIAS` map has
`eventtimeline: 'event-timeline'` (no underscore in the *key*), which does
not match the registered domain string `event_timeline`, so:

```
node scripts/lens-unsurfaced.mjs --lens event-timeline
```
→ `No registered macros found for lens 'event-timeline'` — a **tooling gap**,
not a real absence of macros. This audit did not rely on that script at all;
every reachability claim below is a manual grep + full read of
`app/lenses/event-timeline/page.tsx` and all 5 files under
`components/event-timeline/`. A future fix to `lens-rebuild-backlog.mjs`
should map the alias key to `event_timeline` (or make the alias lookup
underscore/hyphen-insensitive) so the next auditor doesn't lose time here.

There is also a **third, unrelated spelling collision** worth flagging
explicitly: this repo has a completely separate "world event" concept
(Concordia's simulated RSVP/reward events — `server/lib/world-events.js`,
`world-event-scheduler.js`, `event-rsvp`, `event-cascades`, etc., covered by
`server/tests/event-cascades.test.js`, `event-rsvp-world-invites-realtime-emit.test.js`,
`event-scoping.test.js`, `event-shapes.test.js`, `world-event-scheduler.test.js`).
None of those files or tests touch the `event_timeline` domain or
`event_timeline_log` table. Confirmed by reading `server/domains/event-timeline.js`
in full and grepping for cross-references — zero overlap. Same caution as the
`eco.js`/`ecology.js` split documented in `docs/lens-specs/eco-capability-map.md`.

## Backend surface

```
grep -n 'register(' server/domains/event-timeline.js
```
→ **11** macros, all `register("event_timeline", ...)`, in one 426-line file:
`recent`, `stats`, `channels`, `search`, `range`, `detail`, `timeseries`,
`exportEvents`, `saveView`, `listViews`, `deleteView`.

No additional inline registrations exist under either spelling
(`grep -n 'register(\"event_timeline\|registerLensAction(\"event_timeline\|register(\"event-timeline' server/server.js` → only the
`import registerEventTimelineMacros from "./domains/event-timeline.js"` line
and its call site; no ad hoc extra macros bolted on elsewhere).

The domain reads/writes exactly one table, `event_timeline_log`
(migration `169_event_timeline.js`), through `server/lib/event-timeline.js`
(`recordEvent` / `listRecent` / `stats` / `pruneOld`). Critically, this table
is **not a static log an auditor should suspect of being seed data** — it is
fed live: every call to `realtimeEmit(...)` in `server.js` (the single
socket-fan-out chokepoint) also best-effort inserts a row into
`event_timeline_log` (`server.js:8095-8110`, "Sprint 8 — unified timeline
persistence... Every emit also lands in event_timeline_log"). So `recent`,
`stats`, `channels`, `search`, `range`, `detail`, `timeseries`, and
`exportEvents` are all reading the platform's actual live socket firehose —
combat, quests, NPC activity, world state, cross-world plots, cognition
events — not a seeded or synthetic feed. Retention is capped at 30 days
(`PRUNE_OLDER_THAN_SECONDS`), which matters for one design decision below
(the `OnThisDay` panel).

`saveView` / `listViews` / `deleteView` are per-user filter presets, held in
process memory under `globalThis._concordSTATE.eventTimelineLens.views`
(a `Map<userId, Array<view>>`) — see "What changed" for a real bug found and
fixed in how this was wired to disk persistence.

Gate 2 (`publicReadDomains` in `server.js`'s `runMacro`) allowed only
`recent` + `stats` for unauthenticated callers before this pass; `channels`
was added during this audit (see below). The other 8 macros (`search`,
`range`, `detail`, `timeseries`, `exportEvents`, `saveView`, `listViews`,
`deleteView`) correctly stay behind normal auth — `search`/`range`/`detail`/
`timeseries`/`exportEvents` can be more expensive/targeted queries, and the
saved-view macros are inherently per-user.

## Reference apps

- **Event-log / observability explorer**: Datadog Log Explorer, Honeycomb —
  live-tailing feed, full-text + structured search, arbitrary time-range
  query, per-event drill-in with linked context, per-channel trend
  sparklines, saved views/filters, CSV/JSON export.
- **Personal "on this day" memories**: Timehop / Facebook Memories — for the
  *unrelated* `OnThisDay` panel discussed below.

## Classification (before this pass)

**Already strong — Wave 2 built a real, well-wired lens.** Reading
`app/lenses/event-timeline/page.tsx` (613 lines) and all 5 files under
`components/event-timeline/` (`ChannelTrends.tsx`, `EventDetailPanel.tsx`,
`OnThisDay.tsx`, `SavedViewsBar.tsx`, `Sparkline.tsx`, 639 lines combined)
end to end, every one of the 11 `event_timeline` macros has a real,
reachable, non-generic call site:

| Macro | Call site | UI |
|---|---|---|
| `recent` | `page.tsx` `fetchLive()` (5s poll, pausable) | Live-tail event list with category badges, payload summary, relative time, expand-to-raw-JSON |
| `stats` | `page.tsx` `fetchLive()` | "Last 24h" per-channel count strip |
| `channels` | `page.tsx` `fetchLive()` | Exact-channel filter chips (click to filter, shows count + last-seen tooltip) |
| `search` | `page.tsx` `runSearch()` (Enter key or button, `/` focuses the box via `useLensCommand`) | Full-text search mode, re-runs on filter change |
| `range` | `page.tsx` `runRange()` | Date-range mode with two `datetime-local` inputs |
| `detail` | `EventDetailPanel.tsx` (opened via the per-row "detail" button) | Slide-in panel: full payload, linked-entity refs, ±30s nearby events with click-to-jump |
| `timeseries` | `ChannelTrends.tsx` `load()` (30s poll, 3 window presets) | Per-channel sparkline list (`Sparkline.tsx`), click toggles the channel into the shared filter |
| `exportEvents` | `page.tsx` `runExport()` | CSV/JSON download buttons, respects current mode's active filter (search query / range / channels / world) |
| `saveView` | `SavedViewsBar.tsx` `save()` | "Save view" inline-name-then-save UI |
| `listViews` | `SavedViewsBar.tsx` `refresh()` | Renders saved-view chips |
| `deleteView` | `SavedViewsBar.tsx` `remove()` | Per-chip delete (×) button |

No `Math.random()`, no hardcoded stat strings, no lorem/placeholder content,
no fake-success toasts anywhere in these 6 files
(`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/event-timeline/page.tsx components/event-timeline/*.tsx` → no hits). No generic
`<UniversalActions>`/`<LensFeaturePanel>` body — the page is entirely
bespoke, composed of `ChannelTrends`/`EventDetailPanel`/`SavedViewsBar`/
`OnThisDay` plus its own hand-built feed list, search/range controls, and
category toggles. `RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel`
are present but only as the standard bottom-of-page cross-lens strip (not the
`GENERIC_TRIO` pattern — `ManifestActionBar` is absent, and there is
substantial bespoke UI, so `grade-ux-polish.mjs`'s generic-scaffold detector
does not (and should not) fire here).

Given all 11 macros were already genuinely reachable, this audit's findings
are narrower than a typical Wave-3 pass: no dead buttons, no fabricated
panels, no unsurfaced macro clusters. What it found instead were two real
**wiring/gating bugs that don't show up as visibly "fake"** but do violate
the honest-by-construction spirit (a persistence call that can never
persist; a public-safe macro gated as if it weren't), plus one **stale/
misleading doc comment**, plus one **conceptually orphaned but honest**
panel worth flagging for a future decision. All are described and fixed (or
documented) below.

## What changed

1. **Real bug — saved views silently never survived a server restart.**
   `server/domains/event-timeline.js#savedViewsMap()` wrote to a flat
   `globalThis._concordSTATE.eventTimelineViews` field and called
   `persistState()` (`globalThis._concordSaveStateDebounced()`) after every
   `saveView`/`deleteView`, which *looks* like it durably persists the data.
   It does not: `server.js#_serializeState()` (the function the debounced
   save actually calls) only writes the explicit, whitelisted
   `STATE.<x>Lens` buckets listed in
   `server/lib/lens-state-persistence.js#LENS_STATE_KEYS` (26 entries, e.g.
   `chatLens`, `agricultureLens`, `worldLens`) to disk via
   `serializeLensState(STATE)`. A flat ad hoc `STATE.eventTimelineViews` key
   is invisible to that whitelist and was silently dropped from every
   snapshot — so a user could name and save a filter view, see it persist
   across macro calls within the running process, and then lose it on the
   next restart with no error surfaced anywhere. This is the same defect
   class the "wire-the-unwired" / "dead-wired" language in this audit's
   brief describes, just on the persistence layer instead of the frontend:
   a call that appears to do the durable thing but structurally cannot.
   **Fix**: nested the Map under `STATE.eventTimelineLens = { views: Map }`
   (matching every other domain's `STATE.<x>Lens` shape, e.g.
   `server/domains/agriculture.js#getAgriState()`) and registered
   `"eventTimelineLens"` in `LENS_STATE_KEYS`
   (`server/lib/lens-state-persistence.js`, now 27 entries). Pinned by two
   new tests: a round-trip test in `server/tests/lens-state-persistence.test.js`
   (serialize → fresh STATE → hydrate → assert the view survives) and a
   domain-level regression test in
   `server/tests/event-timeline-domain-parity.test.js` asserting `saveView`
   writes into `STATE.eventTimelineLens.views` (a `Map`) and that the old
   flat `STATE.eventTimelineViews` field no longer exists.

2. **Real bug — `channels` was gated as if it exposed something sensitive,
   but it doesn't, and the frontend calls it unconditionally alongside two
   macros that ARE public.** `page.tsx#fetchLive()` calls `recent`, `stats`,
   and `channels` together, unconditionally, on every page mount — including
   for a logged-out visitor (no auth gate wraps this lens page). Gate 2
   (`publicReadDomains.event_timeline` in `server.js`'s `runMacro`) allowed
   only `["recent", "stats"]`; `channels` was left out when the
   activity-feed-parity sprint added it (the surrounding comment still said
   "Sprint 8" / listed only the original two macros). `channels` returns the
   same sensitivity class of data as `stats` — channel name, count,
   last-seen timestamp; no payload content, no actor IDs — so gating it
   differently was inconsistent, not a deliberate security boundary. The
   practical effect: an unauthenticated visitor got a working live feed +
   24h stat strip, but the channel-filter-chip row silently never rendered
   (its `if (r3.data?.result?.ok ...)` branch just never ran), a quiet,
   asymmetric-looking gap in an otherwise-working page. **Fix**: added
   `"channels"` to `publicReadDomains.event_timeline` in `server.js`
   (`event_timeline: new Set(["recent", "stats", "channels"])`), with a
   comment explaining why. Pinned by a new source-text regression test
   (matching the existing convention in `tests/three-gate-consistency.test.js`
   / `tests/lens-auth-gate.test.js`) in
   `server/tests/event-timeline-domain-parity.test.js` asserting the public
   set includes exactly `recent`/`stats`/`channels` and explicitly does
   **not** include any of the 8 payload-bearing or per-user macros.

3. **Doc-accuracy fix — the page's own header comment overclaimed.**
   `app/lenses/event-timeline/page.tsx`'s header said "every panel here is
   backed by a real `event_timeline` macro," immediately followed by a list
   of the 11 macros — but the `OnThisDay` section rendered at the bottom of
   the page (see below) is a real panel that is **not** backed by any
   `event_timeline` macro at all. That's exactly the kind of doc-drift
   CLAUDE.md's "Docs are a build artifact" section warns against — not
   dishonest to the end user (the panel is itself honestly labeled with a
   "wikipedia · /feed/onthisday" source badge), but misleading to the next
   engineer reading the file header. **Fix**: reworded the header to scope
   the claim precisely ("every panel that renders substrate data") and
   added an explicit note about what `OnThisDay` actually is and why it's
   there, with a pointer to this document.

4. **`lens-registry.ts` description was stale.** The command-palette entry
   for this lens read `description: 'World event history'` — a leftover
   from the original Sprint 8 scope (`recent`+`stats` only, and the
   surrounding comment in `server.js` at the time literally said "Powers
   /lenses/timeline," a typo for a lens that doesn't even use this domain —
   see the naming-quirk section above). The current lens is a full
   substrate-wide event firehose (combat/quest/NPC/world/cross-world/
   cognition), materially broader than "world event history," and the
   phrase also risks being read as *the* Concordia world-event system
   (RSVP events), which this is not. **Fix**: updated `description` to
   `'Substrate event firehose — combat, quests, NPCs, cognition, searchable + exportable'`
   and added `firehose`/`log`/`search`/`export` keywords so ⌘K search finds
   it on the terms a user would actually type.

## Deliberately left as-is (documented, not a defect)

**`OnThisDay.tsx` — real external data, honestly labeled, conceptually
orphaned from this lens's actual backend surface.** It fetches Wikipedia's
public `/feed/onthisday/all/{month}/{day}` REST API directly from the client
(no `event_timeline` macro involved), and renders a labeled source badge
("wikipedia · /feed/onthisday") plus a `SaveAsDtuButton` that lets the user
capture a selected entry into their own DTU corpus with real provenance
(`apiSource`, `apiUrl`, `rawData` — the `dtu.create` "provenance-stamped
ingest" pattern CLAUDE.md's live arc calls out as a Wave-1 shared
primitive). This is **not** a hard-invariant violation: the data is real,
not fabricated, and it's honestly attributed as external, not passed off as
substrate data.

It is, however, a genuine scope mismatch worth flagging for a future
decision rather than silently accepting: a Datadog/Honeycomb-style event
explorer has no natural "historical trivia" widget, and this exact same
Wikipedia-on-this-day pattern is independently duplicated in two other
lenses (`components/history/WikipediaOnThisDayPanel.tsx` and
`components/reflection/RfOnThisDayPanel.tsx`) — three near-identical copies
of the same external-API widget across the app. The likely reason a genuine
"on this day in *your* Concord history" feature (which would be the
on-brand, load-bearing choice for this specific lens) wasn't built instead:
`event_timeline_log` only retains 30 days (`PRUNE_OLDER_THAN_SECONDS` in
`server/lib/event-timeline.js`), so there is no year-over-year substrate
data to query — a real "this day last year in the firehose" feature isn't
buildable against the current retention policy. Given that constraint, this
audit's disposition is: **leave it functionally as-is** (removing it would
delete a real, honest, on-brand-adjacent feature; consolidating the 3
duplicate copies into a shared component is a legitimate follow-up but
touches 2 lenses outside this audit's scope and isn't a defect), but fix the
page's own doc comment so it's no longer implied to be part of the
`event_timeline` macro surface (done above), and record the finding here so
a future pass has the context to decide whether a shared
`WikipediaOnThisDayPanel` component (deduped across `history`/`reflection`/
`event-timeline`) or a genuine Concord-native "on this day" feature (would
require lifting the 30-day retention cap for a slice of data, or sourcing
from a longer-retention substrate like `dtus`/`event_timeline` archives) is
the better long-term answer.

## Verification

- `cd server && node --test tests/event-timeline-domain-parity.test.js tests/event-timeline.test.js tests/lens-state-persistence.test.js tests/lens-auth-gate.test.js tests/three-gate-consistency.test.js` → **62/62 passing, 0 failing** (includes the 4 new regression tests added by this pass: 2 in `event-timeline-domain-parity.test.js`, 1 in `lens-state-persistence.test.js` plus the updated key-count assertion, 0 changes needed in the other 3 files — run together only to confirm no cross-file interference).
- `cd server && npx eslint domains/event-timeline.js lib/lens-state-persistence.js tests/lens-state-persistence.test.js tests/event-timeline-domain-parity.test.js` → clean, exit 0.
- `cd server && npx eslint server.js` → clean, exit 0 (full-file lint is affordable here; not a repo-wide/build-heavy operation).
- `cd concord-frontend && npx eslint app/lenses/event-timeline/page.tsx lib/lens-registry.ts` → clean, exit 0.
- Manual type read-through in place of a full-project `tsc --noEmit` (avoided
  here per the task's instructions, to not race sibling agents editing other
  lenses concurrently in the same working tree): every edit to
  `page.tsx` is inside a block comment (zero code/type surface changed);
  the `lens-registry.ts` edit only changes the string values of
  `description: string` and `keywords: string[]` fields on an existing
  `LensEntry` object literal — both fields keep their exact declared types,
  so this is type-safe by construction.
- Fabrication re-grep: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/event-timeline/page.tsx components/event-timeline/*.tsx` → no hits (none before either — this lens was already clean on this axis).
- Did not touch `server/lib/event-timeline.js` (the read/write lib — already
  correct, `recordEvent`/`listRecent`/`stats`/`pruneOld` all behave as
  documented) or any of the 3 `history`/`reflection` Wikipedia-widget files
  (out of scope, see "Deliberately left as-is" above).
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
