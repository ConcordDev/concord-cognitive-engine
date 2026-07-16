# Philosophy Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/philosophy.js` (527 LOC) in full — it is loaded via the
> `domains/index.js` batch loader (`server.js:41685-41686`,
> `import('./domains/index.js')` → `domainModules.forEach(mod =>
> mod(registerLensAction))`), so every macro is genuinely wired into the
> live `LENS_ACTIONS` map, not dead code. No inline
> `registerLensAction("philosophy", ...)` calls exist elsewhere in
> `server.js`; the domain file above is the entire backend surface.
> Classification follows the Frontend Rebuild Program's distinction:
> **DESIGNED** / **GENERIC-STRIP-ONLY** / **UNSURFACED**.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("philosophy"' server/domains/philosophy.js`

## Backend surface — 26 macros, all real (no stubs)

Two tiers, both real: (A) **4 stateless analysis macros** that operate on
a caller-supplied `artifact.data` payload (no persistence) — argument
mapping, thought experiments, Hegelian dialectic, and a 6-school ethics
framework; (B) **22 `STATE.philosophyLens`-backed macros** (per-user
`Map`s: `channels`, `blocks`, `debates`, `references`) that form a genuine
"Are.na-shape idea-curation substrate" (the code's own comment,
`server/domains/philosophy.js:10`) — channels of connected text / link /
quote / image / embed blocks, cross-channel connections, collaborators,
public discovery/publishing, real Wikipedia REST-API rich embeds and
concept/thinker reference pages, a channel↔block connections graph, and a
collaborative argument-debate thread system (support / object / rebut /
clarify stances with tallying).

| Macro | Real result shape (key fields) | Classification (before this rebuild) |
|---|---|---|
| `argumentMap` | premises→conclusion validity/soundness/form | **UNSURFACED** — no UI called it at all pre-rebuild (only reachable via the generic `run` action-fallback, which required knowing the exact macro name) |
| `thoughtExperiment` | scenario + variable permutations + 3 framework hints | **UNSURFACED** — same |
| `dialecticSynthesis` | Hegelian thesis/antithesis/synthesis steps | **UNSURFACED** — same |
| `ethicalFramework` | 6 schools (utilitarian/deontological/virtue/care/rights/justice) applied to a dilemma | **UNSURFACED** — same |
| `channel-create`/`channel-list`/`channel-detail`/`channel-delete` | per-user channel CRUD | **DESIGNED** — `PhilosophyChannels` |
| `block-add`/`block-connect`/`block-delete` | typed block CRUD + cross-channel connect/disconnect | **DESIGNED** — `PhilosophyChannels` (basic text/quote/link) + `PhilosophyCuration` (image blocks) |
| `philosophy-search` | full-text search across channels + blocks | **UNSURFACED** — registered, no UI called it (search UIs exist per-tab in Curation Studio but none hits this cross-cutting macro) |
| `philosophy-dashboard` | channel/block/connected-block counts + kind breakdown | **UNSURFACED** — registered, no UI called it (the page's actual "Dashboard" tab counted the unrelated fake-CRUD artifacts instead) |
| `block-grid` | image-ready blocks for a channel, masonry-sorted | **DESIGNED** — `PhilosophyCuration` "Image Grid" tab |
| `block-embed` | rich Wikipedia link-preview block (thumbnail + extract) | **DESIGNED** — `PhilosophyCuration` "Embeds" tab |
| `channel-publish`/`public-channels`/`public-channel-detail` | visibility toggle + cross-user public discovery/detail | **DESIGNED** — `PhilosophyCuration` "Discover" tab + "Collaborators" tab (publish toggle) |
| `channel-collaborator-add`/`-remove`/`-list` | per-channel collaborator roster | **DESIGNED** — `PhilosophyCuration` "Collaborators" tab |
| `reference-page` | Wikipedia concept/thinker summary + related entries, optional save | **DESIGNED** — `PhilosophyCuration` "Reference Pages" tab |
| `reference-list`/`reference-delete` | saved reference-page library | **DESIGNED** — `PhilosophyCuration` "Reference Pages" tab |
| `connections-graph` | channel/block node-edge graph + cross-channel bridges | **DESIGNED** — `PhilosophyCuration` "Connections" tab (tree diagram) |
| `debate-create`/`debate-post`/`debate-detail`/`debate-list`/`debate-resolve` | collaborative argument-critique threads with stance tally | **DESIGNED** — `PhilosophyCuration` "Debate Threads" tab |

**No macro was fabricated or unregistered.** The finding this rebuild's
capability audit surfaced was the same pattern found in every prior Wave 2
lens: **most of the real surface (18 of 26 macros) was already reachable
pre-rebuild through three well-built components** (`DilemmaPanel.tsx`,
`PhilosophyChannels.tsx`, `PhilosophyCuration.tsx`) — but they were mounted
as an afterthought *below* a disconnected fake-CRUD system that was the
page's actual primary surface, and two real macros
(`philosophy-dashboard`, `philosophy-search`) were registered but never
called by any UI at all.

## Confirmed findings from the task brief

1. **The fake-CRUD-tabs finding is CONFIRMED.** The old page's primary
   surface (`Arguments`/`Concepts`/`Thinkers`/`Traditions`/`Dialogues`/`Dashboard`
   tabs) was backed by `useLensData<PhilosophyArtifact>('philosophy',
   currentType, { seed: [] })` — `concord-frontend/lib/hooks/use-lens-data.ts`
   — which hits the **generic** `GET/POST/PUT/DELETE /api/lens/philosophy`
   REST CRUD system (`server.js:39651-39748`, dispatching through
   `runMacro("lens", "list"/"create"/"update"/"delete", ...)` against
   `STATE.lensArtifacts` — a domain-agnostic free-text artifact store used
   by dozens of lenses, architecturally unrelated to `philosophy.*`). A
   user could type an "Argument" with a free-text description and
   premises and see it rendered as if it were live philosophical
   substrate, while the real `philosophy.argumentMap` engine (which
   actually computes validity/soundness/form from those same fields) sat
   disconnected in `DilemmaPanel` below. The old "Dashboard" tab's stat
   tiles (`arguments_.length`, `concepts.length`, etc.) counted these fake
   records, not anything from `philosophy-dashboard`.

2. **The `'analyze'` finding is CONFIRMED.** `handleAction` called
   `runArtifact.mutate({ id: artifactId, action: 'analyze' })` →
   `useRunArtifact('philosophy')` → `POST /api/lens/philosophy/:id/run`
   with `{ action: 'analyze' }` → `server.js:38269` `register("lens",
   "run", ...)` looks up `LENS_ACTIONS.get('philosophy.analyze')`.
   **`philosophy.analyze` is not a registered action** — none of the 26
   macros above are named `analyze`. Per `server.js:38279-38298`, an
   unregistered `(domain, action)` pair does **not** error — it silently
   falls through to a generic **AI catch-all** (`utilityCall(action,
   artifact.domain, {...})`, routing the literal string `"analyze"` to
   the utility brain as a free-form prompt against whatever the fake
   artifact's title/data/meta happened to contain) and returns `{ ok:
   true, result: { output, source: "utility-brain", ... } }`. Worse: the
   old page's `handleAction` never rendered `runArtifact.data` anywhere —
   the click showed a spinner via `runArtifact.isPending` and then
   nothing, an invisible round-trip to an undesigned LLM catch-all with
   no on-screen result. This button is retired entirely; the 4 real
   analysis macros are now surfaced through `DilemmaPanel`'s dedicated,
   purpose-built UI (structured premise/conclusion/thesis/antithesis
   inputs, one button per macro, visible result panes).

3. **New finding — `useRealtimeLens('philosophy')` was a permanently-dark
   live indicator.** `grep philosophy hooks/useRealtimeLens.ts` returns no
   `DOMAIN_EVENTS` entry for this domain, so `isLive` was always `false`
   and `lastUpdated`/`realtimeData`/`realtimeAlerts`/`realtimeInsights`
   were always empty — the same "decoration masquerading as a live
   status" smell the supplychain rebuild found and removed. Removed here
   too (`LiveIndicator`, `RealtimeDataPanel`, `DTUExportButton` bound to
   the always-empty `realtimeData`, and the `useRealtimeLens` import
   itself are all gone).

4. **New finding — the manifest entry (`lib/lenses/manifest.ts`) described
   the fake system, not the real one.** The `philosophy` entry declared
   `dataTier: 'SIM_GRADE_A'` (rendered by `DepthBadge` as a "Simulated —
   not real data" chip) and `actions: ['analyze', 'generate', 'validate',
   'export', 'summarize']` — the exact boilerplate action list stamped
   across dozens of unrelated lenses, none of which map to a real
   `philosophy.*` macro. Since `ManifestActionBar` and `LensVerticalHero`
   (both retired below) read this list and would dispatch the same dead
   `'analyze'`-style catch-all for every one of those five actions, this
   was a second, structural source of the same defect. Fixed this session
   (`dataTier` → `REAL_FREE`, `actions` → the real macro names,
   `emptyState`/`firstRunGuide` copy rewritten to describe the actual
   Dilemma Workbench + Curation Studio surfaces). `DepthBadge` now
   honestly reads "Real" instead of "Simulated" for this lens.

## 1.5 Reference-parity checklist

**Reference apps:** [Are.na](https://www.are.na) for the curation
substrate — the backend code's own comment explicitly targets "Are.na
shape" (`server/domains/philosophy.js:10`) — cross-checked against
Are.na's real feature set (channels of connected blocks, collaborators,
public/private visibility, cross-channel connections) via web research.
For the dilemma-analysis side, cross-checked against
[Kialo](https://www.kialo.com)-style structured argument mapping (claim →
pro/con premise trees with validity assessment) and
[Stanford Encyclopedia of Philosophy](https://plato.stanford.edu) /
[Internet Encyclopedia of Philosophy](https://iep.utm.edu)-style
peer-authored concept/thinker reference entries. Researched 2026-07-09.

**Parity statement:** the only difference should be that Concord's
curation studio runs on a lens-local per-user in-memory ledger instead of
Are.na's multi-tenant hosted service, and its reference pages pull live
from Wikipedia's REST API rather than a curated peer-reviewed encyclopedia
— real-time channel curation, cross-connection, collaboration, and public
discovery should all be designed, real-data features here, exactly as
Are.na provides them.

| # | Checklist item | Disposition | Justification |
|---|---|---|---|
| 1 | Channels of blocks (the core Are.na primitive) | **ALREADY REAL** | `channel-create`/`block-add` — `PhilosophyChannels` (text/quote/link) |
| 2 | Multiple block types incl. images | **ALREADY REAL** | `block-add(kind='image')` + `block-grid` — `PhilosophyCuration` "Image Grid" tab, masonry layout |
| 3 | A block connectable to multiple channels | **ALREADY REAL** | `block-connect` (connect/disconnect) — pinned by `philosophy-domain-parity.test.js` |
| 4 | Rich link/embed previews | **ALREADY REAL** | `block-embed` — real Wikipedia REST `page/summary` fetch (thumbnail + extract), not a fabricated preview |
| 5 | Channel collaborators (multi-editor channels) | **ALREADY REAL** | `channel-collaborator-add`/`-remove`/`-list` — `PhilosophyCuration` "Collaborators" tab |
| 6 | Public/private visibility + discovery of others' channels | **ALREADY REAL** | `channel-publish` + `public-channels` + `public-channel-detail` — `PhilosophyCuration` "Discover" tab |
| 7 | Cross-channel connection visualization | **ALREADY REAL** | `connections-graph` — `PhilosophyCuration` "Connections" tab (tree diagram + bridge list) |
| 8 | Search across the curation library | **ALREADY REAL — CLOSED (Wave 4 gap-closure)** | `philosophy-search` (searches both channel titles/descriptions and block content across all 5 kinds for the caller's own library) is now surfaced in `PhilosophyCuration`'s new "Search" tab (`SearchTab`, `concord-frontend/components/philosophy/PhilosophyCuration.tsx`) — Enter-to-search input, distinct Channels/Blocks result sections (blocks show their kind + a 160-char excerpt + owning-channel title), an honest empty-query prompt and no-results state, and a working deep-link from a block result into the Image Grid tab focused on the block's owning channel. No backend change was needed — the existing `{channels, blocks, count}` shape (with `channelIds` for the deep-link) was already sufficient; extending it would have been scope creep against the ENGINEERING triage class (a UI-only gap, not a data or endpoint gap). Pinned by `concord-frontend/tests/components/PhilosophyCuration.test.tsx` (5/5: channel-result rendering, block-result rendering incl. channel-title resolution, empty-query state, no-results state, deep-link) |
| 9 | Structured argument mapping (claim → premises → conclusion, validity check) | **ALREADY REAL** | `argumentMap` — now surfaced in `DilemmaPanel`'s "Argument map" action with structured premise/conclusion inputs (was previously reachable only via the fake CRUD's free-text `premises`/`conclusion` fields, which never actually invoked this macro) |
| 10 | Collaborative critique of an argument's premises | **ALREADY REAL** | `debate-create`/`debate-post`/`debate-detail` — `PhilosophyCuration` "Debate Threads" tab, 4 stances (support/object/rebut/clarify) with live tally |
| 11 | Peer-authored concept/thinker reference entries | **ALREADY REAL (proxy source)** | `reference-page` — real Wikipedia REST `page/summary` + `page/related`, saved to a per-user library via `reference-list`/`reference-delete`. Honest proxy for a full IEP/SEP-style peer-reviewed entry (Concord has no editorial encyclopedia of its own); no fabricated claim of "peer-reviewed" anywhere in the UI |
| 12 | Single control-tower-style landing view aggregating the workspace, not a config screen | **GENUINELY MISSING (pre-rebuild) → FIXED THIS SESSION** | The page's PRIMARY surface was a generic multi-artifact-type CRUD library (`Argument`/`Concept`/`Thinker`/`Tradition`/`Dialogue`, backed by `useLensData`'s generic DTU-artifact system) — these records were NOT the real channels/blocks/debates/references above; they were a parallel, disconnected fake data model. This was the single biggest honesty gap found in this audit, matching the pattern found in every prior Wave 2 lens. New `PhilosophyOverview.tsx` aggregates 4 real macro calls (`philosophy-dashboard`, `debate-list`, `reference-list`, `public-channels`) into KPI tiles + a recent-debates panel + quick-jump cards |
| 13 | The 4 real analysis macros (argumentMap/thoughtExperiment/dialecticSynthesis/ethicalFramework) reachable through a designed UI | **ALREADY REAL, pre-existing but effectively hidden → PROMOTED THIS SESSION** | `DilemmaPanel.tsx` already wired all 4 with structured inputs + result panes + mint/DM/publish/agent-synthesis bonus actions — it was real and complete, just mounted below the fake CRUD system as an afterthought section. Promoted to its own primary "Dilemma Workbench" destination |
| 14 | Multi-tenant hosted service / team workspaces at Are.na's scale | **GENUINELY MISSING — HONEST, NO CHANGE NEEDED** | Concord's curation substrate is a self-contained lens-local per-user ledger (`STATE.philosophyLens`), never claimed to be a hosted multi-tenant service; no fabricated "synced to the cloud" claim exists anywhere in the UI to walk back |

**Coverage summary:** 12 of 14 checklist items already real before this
session; 1 fixed this session (control-tower-style landing view promoted
to primary, replacing the fake CRUD library); 1 promoted from
buried-afterthought to primary destination; 1 resolved as an honest
non-issue (no multi-tenant claim exists). **Update (Wave 4 gap-closure,
2026-07-16): the 14th item — cross-cutting library search, previously
named-deferred — is now closed.** `philosophy-search` was already real
backend-side (registered + tested); the only gap was UI, which the new
`SearchTab` in `PhilosophyCuration.tsx` closes with no backend change.
**No remaining gaps.**

## 2. What this rebuild changed

**Killed the fake generic CRUD library** that was the page's PRIMARY
surface: `app/lenses/philosophy/page.tsx` used to model
"Arguments/Concepts/Thinkers/Traditions/Dialogues" as 5 generic
`useLensData`-backed DTU-artifact types (`PhilosophyArtifact` with a
shared `artifactType` discriminant), free-form user-entered records with
no connection whatsoever to the real `philosophy` macros above — plus a
"Dashboard" tab whose stat tiles counted these fake records. A user could
type in a fake "Argument" and see it rendered as if it were live
philosophical substrate, while the REAL argument-mapping engine and the
REAL Are.na-shape curation substrate sat disconnected in footer sections
below. The "Run AI analysis" button on the fake CRUD's detail panel
dispatched an unregistered `philosophy.analyze` action that silently fell
through to a generic, undesigned utility-brain AI catch-all with no UI
surface to show the result — a real, confirmed dead/opaque interaction.
**This was the single most important fix in this rebuild.**

**Retired the generic-scaffold + permanently-dark-live dependencies**:
removed `ManifestActionBar`, `AutoActionStrip`, `RecentMineCard`,
`CrossLensRecentsPanel`, `LensVerticalHero`, `LensFeaturePanel`,
`UniversalActions`, and the useless-when-dark `useRealtimeLens` /
`LiveIndicator` / `RealtimeDataPanel` / `DTUExportButton(realtimeData)`
set (confirmed via `grep philosophy hooks/useRealtimeLens.ts` — no
`DOMAIN_EVENTS` entry, so `isLive` was always `false`). `ManifestActionBar`
and `LensVerticalHero` in particular read the stale manifest's
`actions: ['analyze', 'generate', 'validate', 'export', 'summarize']`
list and would have dispatched the same dead catch-all pattern for every
button — a second, structural instance of the `'analyze'` defect, closed
by removing both components and fixing the manifest entry.

**New `PhilosophyOverview.tsx`** — a real curation-studio landing
dashboard (checklist item 12 above): 4 parallel macro calls
(`philosophy-dashboard` / `debate-list` / `reference-list` /
`public-channels`) rolled into KPI tiles (`StatTile`/`StatTileGrid` from
`components/ui/`) + a block-kind-mix chip row + a recent-debate-threads
panel + quick-jump cards into the Dilemma Workbench / Curation Studio
destinations. Honest loading (`role="status"`), error (`role="alert"`
with the real error text), and empty (`EmptyState` with a real "open
Curation Studio" CTA, not a seeded demo) states — pinned by the new
`tests/philosophy-lens-states.test.tsx`.

**Manifest honesty fix** (`lib/lenses/manifest.ts`): the `philosophy`
entry's `dataTier` changed from `SIM_GRADE_A` ("high-fidelity simulation,
not real data" — rendered as a "Simulated" chip by `DepthBadge`) to
`REAL_FREE`; `actions` changed from the generic
`['analyze','generate','validate','export','summarize']` boilerplate to
the real macro names; `emptyState`/`firstRunGuide` copy rewritten to
describe the actual Dilemma Workbench + Curation Studio surfaces instead
of the retired fake "Arguments/Concepts/Traditions/Texts/Debates" system.
`DepthBadge` on this lens now honestly reads "Real" instead of
"Simulated."

**New page shell** — 4 bespoke destinations (Overview / Dilemma Workbench
/ Curation Studio / Community Pulse) replacing the old 6-tab generic CRUD
library + buried real components. `g <letter>` keyboard shortcuts per
destination. `DilemmaPanel`, `PhilosophyChannels`, `PhilosophyCuration`,
and `PhiloFeed` (a real `philosophy.stackexchange.com` API feed) were
**not modified** — they were already real, well-built, macro-wired
components; this rebuild's job was promoting them to the primary surface
and killing the fake system that buried them, not rewriting working code.
`WikipediaSearchPanel` (general free-text Wikipedia search, distinct from
Curation Studio's topic-specific `reference-page` lookup) moved from a
page-top mount into the Curation Studio destination where it's contextually
relevant.

## Files touched

- `concord-frontend/app/lenses/philosophy/page.tsx` — rewritten
- `concord-frontend/components/philosophy/PhilosophyOverview.tsx` — new
- `concord-frontend/lib/lenses/manifest.ts` — `philosophy` entry only: `dataTier`, `actions`, `artifacts`, `emptyState`, `firstRunGuide` corrected to describe the real surface
- `concord-frontend/tests/philosophy-lens-states.test.tsx` — new, pins the four UX states of the new primary `PhilosophyOverview` surface (loading/error/empty/populated) and asserts the retired `'analyze'` action is never dispatched

**Not touched (already real, verified by reading in full, left as-is):**
`concord-frontend/components/philosophy/DilemmaPanel.tsx`,
`concord-frontend/components/philosophy/PhilosophyChannels.tsx`,
`concord-frontend/components/philosophy/PhilosophyCuration.tsx`,
`concord-frontend/components/philosophy/PhiloFeed.tsx`,
`server/domains/philosophy.js`,
`server/tests/philosophy-domain-parity.test.js`.
