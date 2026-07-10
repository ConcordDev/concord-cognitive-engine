# Genesis Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("genesis"' server/domains/genesis.js
```
→ **9** macros in `server/domains/genesis.js` (378 lines) — a small, focused
domain file, confirmed via `grep -oE 'registerLensAction\("[a-z0-9_-]+"'
server/domains/genesis.js` to register only under the single domain string
`"genesis"`. `grep -rl '"genesis"' server/domains/*.js server/server.js`
confirms no second file also registers under `"genesis"`; the string-literal
hits inside `server.js` (`kind: "genesis"`, `lineage || "genesis"`,
`createNewbornEntity(..., "genesis")`) are unrelated — they're the
`digital_native`/newborn-entity spawn subsystem tagging a lineage string
`"genesis"`, not this domain's macro registration.

The 9 macros: `identity-detail` (full per-emergent action/decision
timeline), `roster-search` (filter/search the roster by role/focus/state),
`relationship-graph` (communication graph between emergent identities),
`feed-filtered` (event-type-filtered live feed), `lineage` (naming-origin
ancestry chain / descendants / cohort), `metrics` (counts, activity-over-time,
focus distribution, top contributors), and `search-save`/`search-list`/
`search-delete` (per-user saved roster-search presets, persisted in
`globalThis._concordSTATE.genesisSavedSearches`).

**What this lens actually is, confirmed by reading all 9 handlers end to
end:** an observability window into Concord's own **emergent AI identity**
substrate — autonomous personas (`emergent_identity` table: given name,
naming origin, current focus, role, last-active) that arise inside the
platform and act (observations, cross-identity communications, tasks,
artifacts) over `emergent_observations`/`emergent_communications`/
`emergent_activity_feed`/`emergent_tasks`. All 6 read macros are pure
SQL-backed compute over these five real tables — no synthesized data, no
LLM calls, no external I/O. **This is genuinely distinct from Concordia's
world-creator/world-generation system** (`server/domains/world-creator.js`,
`content/world/`) as CLAUDE.md's Concordia section warns it might be
confused with: world-creator builds 3D game-world content (terrain,
buildings, NPCs) for the civilization simulator; genesis observes a
completely separate substrate of self-naming emergent AI agents that exist
platform-wide, independent of any 3D world. No overlap in tables, macros, or
purpose was found — confirmed by grepping `emergent_identity` and
`world-creator` for any shared reference (none).

`server/domains/genesis.js`'s own header comment states the REST router
`server/routes/emergent-visibility.js` (mounted at `/api/emergents`,
`server.js:33661`) is "the genesis lens's live backend" — verified: 6 of the
9 compute functions (`computeIdentityDetail`, `computeRosterSearch`,
`computeRelationshipGraph`, `computeFeedFiltered`, `computeLineage`,
`computeMetrics`) are exported by name from `genesis.js` and imported
directly into the REST router, which exposes them at `/api/emergents/:id/
timeline`, `/roster/search`, `/graph/relationships`, `/feed/filtered`,
`/:id/lineage`, `/metrics/summary` — the exact same compute, two transport
paths (macro dispatch + REST), one source of truth.

`node scripts/lens-unsurfaced.mjs --lens genesis` reports **4/9 macros
"never referenced"**: `identity-detail`, `roster-search`,
`relationship-graph`, `feed-filtered`. This is the same class of false
negative documented in the film-studios capability map — the script's static
grep looks for `lensRun('genesis', '<macro>', …)` call sites and cannot see
the REST-router indirection. Manually verified all 4 are genuinely wired:
`IdentityTimeline.tsx` fetches `/api/emergents/:id/timeline`,
`RosterExplorer.tsx` fetches `/api/emergents/roster/search`,
`RelationshipGraph.tsx` fetches `/api/emergents/graph/relationships`, and
`page.tsx` fetches `/api/emergents/feed/filtered` directly — all four routes
call straight into the corresponding `genesis.js` compute function with no
detour. The remaining 3 macros (`search-save`/`search-list`/`search-delete`)
*are* dispatched the conventional `lensRun('genesis', …)` way, from
`SavedSearchesPanel.tsx`. **Net: 9/9 macros have a real, live UI caller.**

No inline `registerLensAction("genesis"…)` calls exist outside the domain
file. `server/lib/lens-manifest.js`/`lens-features*.js` were not checked for
a per-macro feature table (this lens predates that convention, same as
`eco`) — it is registered in `lens-registry.ts` as a standalone entry.

## Reference apps

No direct consumer rival exists for "browse the AI agents your own platform
spawned" — the closest real-world analogs are **AI-agent observability /
tracing consoles**: **LangSmith** (agent run traces, filterable run list,
per-run timeline) and **Datadog APM** (service map / relationship graph
between components, saved views, metrics dashboards with time-window
toggles). The parity target, in the owner's framing: the only difference
should be that Concord's "traces" are autonomous *identities* with names and
lineage rather than anonymous service spans — the UX primitives (filterable
roster, per-entity timeline, relationship graph, saved views, metrics
dashboard) are the same category of tool.

## Classification (before this pass)

**Strong — already through a full prior rebuild (`docs/lens-specs/
genesis.md`, dated 2026-05-21, backlog 100% `[x]`), independently re-verified
this pass rather than taken on faith.** Read `app/lenses/genesis/page.tsx`
(459 lines) and all 7 `components/genesis/*.tsx` files (919 lines total) in
full.

- `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/genesis/page.tsx components/genesis/*.tsx` → **zero hits.** No fabricated data
  anywhere in the lens.
- All 6 REST-routed macros + all 3 saved-search macros map to a real,
  designed component (`RosterExplorer`, `IdentityTimeline`, `LineageView`,
  `RelationshipGraph`, `GenesisMetrics`, `SavedSearchesPanel`) — no generic
  action-array wall, no `<UniversalActions>`/`<LensFeaturePanel>` doing the
  real work (`ManifestActionBar`/`AutoActionStrip` are present but as the
  standard small secondary strips, not the page's substance).
- **`OriginExplorer.tsx` is a bonus component with no backing macro** — it
  pulls live summaries from the public Wikipedia REST API
  (`en.wikipedia.org/api/rest_v1/page/summary/:topic`) for a curated set of
  cosmogony/origin topics (Big Bang, Abiogenesis, Cambrian explosion, the
  Genesis creation narrative, etc.), with a real loading/error state and a
  "Save as DTU" action. This is **not fabricated content** — it's a genuine,
  live, cited external-API call, thematically fitted to the lens's name —
  but it is also not the emergent-AI-identity observatory the other 6 panels
  are; it's a curiosity/reference sidebar. Left as-is: real, honestly
  sourced, clearly labeled ("wikipedia REST · live" badge), does not
  misrepresent itself as backend depth.

**One real, confirmed defect found and fixed:** `SavedSearchesPanel`'s
"saved search" feature was two bugs deep from actually working end to end —
present in the UI, backed by a real macro, but non-functional:

1. **Data-shape mismatch.** `genesis.search-save` stores entries as
   `{ id, label, filters: { query, role, state, focus }, createdAt }`
   (`server/domains/genesis.js:378-395`) — filters nested under `.filters`.
   The component's `SavedSearch` interface declared flat `query?`/`role?`/
   `state?`/`focus?` fields directly on the entry, which never existed on
   the real returned object. Every saved search's query/filter preview
   silently rendered as nothing (`s.query` was always `undefined`).
2. **`onRun` was declared but never wired.** `app/lenses/genesis/page.tsx`
   mounted `<SavedSearchesPanel className="mt-6" />` with no `onRun` prop —
   clicking a saved search's label called `onRun?.(s)`, a guaranteed no-op.
   A user could save a search and delete a search, but could never actually
   *run* one — the entire point of the feature. This is the "dead button
   citing a real macro" defect class CLAUDE.md's zero-generic-tendencies
   invariant targets, just one level deeper than a literal generic
   component: a bespoke, well-designed panel with one silently-broken wire.

Additionally, the save form only ever captured a hand-typed `query` string
disconnected from the roster's actual live filters (role/focus/state chosen
in `RosterExplorer` were never part of what got saved), even though the
backend macro (and its own UI's own filter controls) fully supports all
four fields — a feature-completeness gap on top of the two bugs.

A third, smaller defect: the empty-feed state's "Explore the roster" link
pointed at `/lenses/genesis#roster`, but no element on the page carried
`id="roster"` — the fragment link was a dead affordance (scrolled nowhere).

## What changed

- **`concord-frontend/components/genesis/RosterExplorer.tsx`** — added
  `onFiltersChange` (fires whenever the live query/role/focus/state change,
  so a parent can read "what's currently filtered"), and `applyFilters`/
  `applyKey` (external filter application — re-running a saved search sets
  all four fields and re-triggers the existing debounced fetch). Exported a
  new `RosterFilters` type as the shared contract.
- **`concord-frontend/components/genesis/SavedSearchesPanel.tsx`** (rewrite)
  — fixed the `SavedSearch` interface to the real nested
  `filters: { query, role, state, focus }` shape; added a `filterSummary()`
  helper rendering a compact human-readable chip (`"topology" · role:scholar
  · focus:math · active`) per saved search; replaced the disconnected
  "type a query" save form with **"Save current filters"**, which now
  captures the live `currentFilters` prop (lifted from `RosterExplorer`) and
  sends the full `{query, role, focus, state}` set to `genesis.search-save`
  — disabled with an honest tooltip when no filter is active, so an empty
  "save everything" entry can't be created; clicking a saved search now
  calls the real `onRun(filters)` callback with the flattened filter set
  extracted from the nested shape.
- **`concord-frontend/app/lenses/genesis/page.tsx`** — lifted roster-filter
  state (`rosterFilters`, `appliedFilters`, `appliedKey`) between
  `RosterExplorer` and `SavedSearchesPanel`; wired `onFiltersChange`/
  `applyFilters`/`applyKey` into `RosterExplorer` and `currentFilters`/
  `onRun` into `SavedSearchesPanel`; `runSavedSearch()` applies the filters
  and smooth-scrolls the roster into view so the result is visible feedback,
  not a silent state change off-screen. Added `id="roster"` (+
  `scroll-mt-6`) to the roster section so the pre-existing "Explore the
  roster" `#roster` link now actually lands somewhere.
- **`concord-frontend/tests/genesis-saved-searches.test.tsx`** (new) — 5
  tests pinning both fixed bugs: the nested-`.filters` shape renders a real
  summary (was blank), clicking a saved search calls `onRun` with the
  correctly flattened filter object, the run affordance is honestly
  `disabled` when no handler is wired (rather than silently inert), the
  save button is disabled with no active filters and enabled once one is
  set, and saving posts the full `{query, role, focus, state}` set to
  `genesis.search-save` — not just a typed query string.

No backend changes were needed or made — `server/domains/genesis.js` and
`server/routes/emergent-visibility.js` were both already correct; the bug
was entirely a frontend type/wiring mismatch against a correct backend
contract.

## Verification

- `cd concord-frontend && npx eslint app/lenses/genesis/page.tsx components/genesis/RosterExplorer.tsx components/genesis/SavedSearchesPanel.tsx tests/genesis-saved-searches.test.tsx` — clean, exit 0.
- `cd concord-frontend && npx vitest run tests/genesis-lens-states.test.tsx tests/genesis-saved-searches.test.tsx` → **11/11 passing** (6 pre-existing + 5 new), 0 regressions.
- Manual type read-through in place of a full-project `tsc` (avoided here to
  not race the 5 sibling agents editing other lenses concurrently in the
  same working tree): `RosterFilters` is exported once from
  `RosterExplorer.tsx` and imported by both `page.tsx` and
  `SavedSearchesPanel.tsx` with matching field names/literal-union `state`
  type; `applyFilters?: Partial<RosterFilters> | null` accepts the page's
  `RosterFilters | null` state (a full object satisfies `Partial<...>`);
  `onFiltersChange`/`onRun`/`currentFilters` prop types line up exactly
  between the two components and the page's `runSavedSearch` /
  `rosterFilters` state declarations.
- Fabrication re-grep after the edit: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/genesis/page.tsx components/genesis/*.tsx` → no hits (was 0 before, stays 0).
- `node scripts/lens-unsurfaced.mjs --lens genesis` → unchanged at
  `4/9 macros never referenced` — expected: the fix was reachability/
  correctness of already-"referenced" macros (`search-save`/`search-list`/
  `search-delete` were already `lensRun`-dispatched; the bug was in how the
  returned data was consumed and whether the result was actually applied),
  not new macro surfacing. All 9 macros were and remain live-called; the
  script's REST-router blind spot for the other 4 is unchanged (see
  Backend-surface section — same class of false negative as film-studios'
  `vision` macro, verified by hand both before and after).
- `cd server && node --test tests/genesis-domain-parity.test.js tests/genesis-lens.test.js` → **38/38 passing**, unaffected (no backend files touched).
- Did not touch `server/domains/genesis.js`, `server/routes/emergent-visibility.js`, `components/genesis/IdentityTimeline.tsx`, `components/genesis/LineageView.tsx`, `components/genesis/RelationshipGraph.tsx`, `components/genesis/GenesisMetrics.tsx`, or `components/genesis/OriginExplorer.tsx` — each was read in full and confirmed to have no gap.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
