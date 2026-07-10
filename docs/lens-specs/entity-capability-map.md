# Entity Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("entity"' server/domains/entity.js
```
→ **18** macros, all `registerLensAction("entity", ...)`. `server/domains/entity.js` is
1,185 lines.

```
grep -n '^register("entity"' server/server.js
```
→ **2** more, registered inline: `entity.terminal` (`server.js:11887`) and
`entity.terminal_approve` (`server.js:12158`). These use the **canonical**
`register()` macro form (not `registerLensAction()`), so they live in `MACROS`,
not `LENS_ACTIONS` — a distinction that turns out to matter (see "Confirmed
dead-wired" below). Total backend surface: **20 macros**.

`node scripts/lens-unsurfaced.mjs --lens entity` → `entity: 0/18 macros never
referenced in the frontend` — the script only walks `LENS_ACTIONS`-style
registrations in the domain file, so it can't see `terminal`/`terminal_approve`
at all, and (like the `eco` audit) "referenced" isn't the same claim as
"reachable" — see below.

The 18 domain-file macros split into two generations, both real:
- **3 "legacy" artifact-based macros** (`entityResolution`, `relationshipGraph`,
  `attributeValidation`, lines 13–714): sophisticated, correct, pure-compute
  algorithms — Jaro-Winkler probabilistic record linkage with union-find
  merge-cluster detection, BFS-based betweenness/closeness/degree centrality +
  cycle detection + connected-components, and a schema-driven type/format/
  range/enum/consistency-rule validator (12 format validators including a real
  Luhn credit-card check). They read `artifact.data.records` /
  `.data.entities`+`.data.relationships` / `.data.entity`+`.data.schema`.
- **15 "knowledge-graph workbench" macros** (lines 716–1184, comment: "per-user
  persistent entity/relationship store, typed schemas, attribute provenance,
  path-finding, merge/split, and CSV/JSON + Wikidata import"): `graph-get`,
  `node-create/update/delete`, `edge-create/delete`, `schema-list/save/delete`,
  `node-merge`, `node-split`, `path-find`, `import-bulk`, `import-wikidata`,
  `provenance-report`. All operate on a real per-user in-memory+persisted
  store (`STATE.entityGraph.{nodes,edges,schemas}`, each a `Map<userId,
  array>`), saved via `saveStateDebounced()`.

## `server/lib/entity-lock.js` / `entity-power.js` — confirmed decoys, unrelated

Per the task's own caution flag: `entity-lock.js` is a generic per-key async
mutex utility (`withEntityLock`) used across craft/trade/gather handlers to
close TOCTOU double-spend windows — "entity" here means "any lockable
resource key" (`item:<id>`, `node:<id>`, `trade:<id>`), not this lens's
entities. `entity-power.js` derives NPC combat HP/attack from grown
level/skill for the Concordia world simulator ("WS1 — Absolute power becomes
mechanically real"), gated by `CONCORD_ABSOLUTE_POWER`. Both are pure
Concordia-world-sim infrastructure with **zero relation** to
`server/domains/entity.js`'s knowledge-graph macros — confirmed by reading
both files in full; neither imports nor is imported by `domains/entity.js`,
and neither macro namespace overlaps (`entity-lock`/`entity-power` export
plain functions, not `register()`/`registerLensAction()` macros). Their tests
(`entity-lock.test.js`, `entity-power.test.js`) are pinned Concordia-combat
contract tests, not entity-lens tests — left untouched, all 35/35 green (see
Verification).

## Reference app

A Wikidata Query Service / Palantir Foundry-style entity-resolution and
knowledge-graph workbench: typed entity classes, attribute provenance
per-source, node merge/split reconciliation, shortest-path queries, bulk +
live Wikidata import, and duplicate/centrality/schema analysis over the graph.
`KnowledgeGraphWorkbench.tsx`'s own docstring says exactly this.

## A second, unrelated real system shares this page

`app/lenses/entity/page.tsx`'s header reads "Create and manage **swarm
entities** with terminal access" — a completely different product framing
from the knowledge-graph reference app above, and it turns out to be backed
by a **third, unrelated real backend surface**: `/api/worldmodel/*`
(`server/routes/domain.js:501-576`, dispatching to a `worldmodel` macro
domain — `list_entities`/`create_entity`/`get_entity`/... — for
counterfactual-reasoning "world model" entities) plus `/api/qualia/*`
(`server/server.js:31672`, the embodied-cognition sensory substrate) plus
`GET /api/entity/:id/cognitive` (a REST route, not a macro). None of these
three live in `server/domains/entity.js`, and none are fabricated — each is a
real, working backend — but they represent a genuinely different product (an
agent/emergent-entity monitoring console) sharing this page's URL slot under
overloaded "entity" terminology, the same way `docs/lens-specs/eco-capability-
map.md` documented `eco.js` vs. the unrelated `ecology.js` — except here it's
the same page, not a separate lens. Splitting these onto separate pages is a
product decision outside a single-lens Wave-3 pass; this map documents the
distinction and fixes the one concrete defect living inside it (Terminal,
below) without attempting the larger split.

## Audit findings

### 1. Confirmed dead-wired (fixed): the Terminal modal never worked

`page.tsx`'s "Terminal" button/modal (spawn a "swarm entity" → click Terminal
→ type a command) called:
```ts
apiHelpers.lens.run('entity', data.entityId, { action: 'terminal', params: { command: data.command } })
```
`apiHelpers.lens.run(domain, id, data)` POSTs to `/api/lens/:domain/:id/run`
(`server.js:39709`), which dispatches to the `lens.run` **macro**
(`server.js:38269`): `const artifact = STATE.lensArtifacts.get(id); if
(!artifact) return { ok: false, error: "not found" };`. `data.entityId` here
is a `/api/worldmodel/entities` id — a **completely different store**
(`worldmodel` macro domain, not `STATE.lensArtifacts`). That id is never a key
in `STATE.lensArtifacts`, so this call returned `{ok:false, error:"not
found"}` on **every single command, unconditionally** — regardless of the
`ENABLE_TERMINAL_EXEC` flag, regardless of the command typed. A fully-built
terminal UI (styled output pane, command history, Enter-to-run) that could
never once actually reach `entity.terminal`.

Root cause, independent of the artifact-id mismatch: `entity.terminal` is
registered via `register()` (canonical `MACROS`), and `lens.run`'s handler
lookup is `LENS_ACTIONS.get(\`${artifact.domain}.${action}\`)` only — it
**can't see `MACROS`-registered actions at all**, even with a valid artifact
id. The correct call is `POST /api/lens/run` (`apiHelpers.lens.runDomain`),
which checks `LENS_ACTIONS` **then falls back to `MACROS`** — the only path
that can reach a `register()`-only macro like this one.

**Fixed**: `executeTerminal`'s `mutationFn` now calls
`apiHelpers.lens.runDomain('entity', 'terminal', { command: data.command })`.
The `onSuccess` handler was also rewritten — the prior code only ever checked
`data.output || data.error`, but the real handler's success shape is
`{ok:true, exitCode, stdout, stderr, riskLevel}` (no `.output` field), so a
genuinely-successful low-risk command used to fall through to a raw
`JSON.stringify(data)` dump. It now renders `disabled` / `pending_council_
approval` / rejection / real `stdout`+`stderr`+`exitCode` cases explicitly and
honestly — never a fabricated "it ran" line for a command that didn't.

Note: `ENABLE_TERMINAL_EXEC` defaults **off** (`server.js:2655`), so in a
default deployment the fixed call now honestly returns "Terminal execution is
disabled" instead of a permanent, flag-independent "not found" — the fix
makes the feature's behavior finally track the security flag it's gated by.

### 2. Confirmed dead-wired (fixed): `entityResolution` / `relationshipGraph` / `attributeValidation` had no reachable input

The exact "backend-capable-but-unsurfaced" defect class from the `eco` audit:
`page.tsx`'s "Entity Domain Actions" panel gated all three buttons on
`entityArtifacts[0]?.id`, sourced from
`useLensData('entity', 'entity', { seed: [] })` — an empty seed, and **no
creation form for a domain=`entity`/type=`entity` artifact anywhere in this
page or the rest of the frontend** (confirmed:
`grep -rn "useLensData.*'entity', 'entity'" concord-frontend/` matched only
this one read site). `entityArtifacts` was permanently `[]` in production, so
all three buttons were permanently `disabled`. The math itself (verified by
reading `entity.js:13-714`) is genuinely good — this was a pure reachability
gap, not fabrication.

### 3. Confirmed broken (fixed): `<ManifestActionBar />` fired six nonexistent macro names

`lib/lenses/manifest.ts:1188`'s `entity` domain entry declares `actions:
['resolve_entity', 'link_evidence', 'merge_duplicates', 'relationship_map',
'confidence_score', 'provenance_trace']`. **None of these match any real
macro** in `entity.js` (`entityResolution`, `relationshipGraph`,
`attributeValidation`, `node-*`, `edge-*`, `schema-*`, `path-find`,
`import-*`, `provenance-report`). Every button in the auto-generated
`ManifestActionBar` would call `runDomain('entity', 'resolve_entity', {})` →
`POST /api/lens/run` → no `LENS_ACTIONS`/`MACROS` match → `{ok:false,
error:"unknown_macro"}` (`server.js:39586`, the honest fail-fast path, not
the old LLM-masking one — so at least it never lied, but it never worked
either). Same defect pattern as `docs/lens-specs/bridge-capability-map.md`'s
"Confirmed broken (fixed)" finding, down to the exact mechanism.

### 4. Confirmed redundant (removed): `<AutoActionStrip domain="entity" />`

Auto-discovers every macro registered under `entity` via
`GET /api/lens-actions/{domain}` (a real introspection endpoint, unlike the
static manifest) and renders a raw button + JSON-paste-input per action. Once
the Analyze tab (below) covers all 3 legacy macros and the Terminal fix
covers `terminal`, every one of the 20 macros has purpose-built UI — this
strip would only duplicate them as a generic button wall, the "zero generic
tendencies" invariant's named failure mode. (It also inherits the same
architecture bug as finding #1: its click handler routes through
`useRunArtifact` → `apiHelpers.lens.run` → the same `STATE.lensArtifacts`-by-id
lookup with a synthesized `${domain}-auto-${Date.now()}` id that never
exists, so its buttons for `terminal`/`terminal_approve`/any `MACROS`-only
action would silently 404 too. That's a shared-component bug in
`AutoActionStrip.tsx`/`useRunArtifact` affecting every lens with
`register()`-only macros — out of scope to fix here since it's infra shared
by many lenses; removing the strip from this lens's page neutralizes it
locally, matching the `bridge` lens's precedent.)

### 5. Deliberately left unsurfaced (honest disposition): `entity.terminal_approve`

The council-vote approval workflow for medium/high-risk terminal commands
(3-vote quorum, 60%/75% approval thresholds, `server.js:12158-12230`) has
**no listing mechanism at all** — `grep -n "terminalRequests" server/
server.js` shows the queue is only ever pushed to (`terminal`) and searched
by exact id (`terminal_approve`); there is no macro or route that returns the
list of pending proposals for a reviewer to see. Building a real approval UI
would require adding a new backend list endpoint plus role-gated vote
buttons — a distinct governance-console feature, not a frontend reachability
fix, and (like `eco`'s `sustainabilityScore`) orthogonal to this lens's actual
reference-app scope: `ENABLE_TERMINAL_EXEC` defaults off, the existing
`council` lens's own proposal system (`useLensData('council', 'proposal',
...)`) is unrelated infrastructure and doesn't cover this queue either. Left
registered and functional at the macro layer (an admin/council member with
API access can still call it directly); not wired to any UI. Matches the
"genuinely missing feature-market fit for this lens as scoped" disposition
from the `eco` audit, not a defect to paper over.

## What changed

- **`concord-frontend/components/entity/KnowledgeGraphWorkbench.tsx`** —
  added a 7th tab, **Analyze**, with three real sub-panels that run the three
  previously-unreachable legacy macros directly against the live graph (no
  artifact needed, via the same virtual-artifact `/api/lens/run` mechanism
  `eco`'s `CarbonCalculator` uses):
  - **Duplicates** (`entityResolution`): builds `records` from every graph
    node's `name` + provenance-tracked attributes, with a threshold input;
    renders match pairs with confidence bars, and each pair gets a **"Review
    in Merge tab"** button that pre-fills the existing Merge/Split tab's
    source/target selects and switches to it — a genuine designed integration
    between duplicate-detection and the existing merge-reconciliation UI, not
    a bolted-on result dump. (New `mergePrefill` state + `prefill`/
    `onPrefillConsumed` props on `MergeSplitTab`.)
  - **Graph Analytics** (`relationshipGraph`): builds `entities`/
    `relationships` straight from `graph.nodes`/`graph.edges`; renders entity
    count, relationship count, graph density, connected components, key
    connectors, and detected cycles (with node names resolved from ids).
  - **Schema Validation** (`attributeValidation`): select a node + one of the
    graph's own entity-class schemas (already real, from the Schemas tab);
    validates the node's attributes against the schema's field
    types/required flags, with `email`/`url` schema types mapped onto the
    handler's real format validators (not just a no-op type check) for a
    genuine format-check integration. Renders validation score, errors,
    warnings.
  - The three result-render components (adapted from the old page.tsx panel)
    live in this file now, not the page.
- **`concord-frontend/app/lenses/entity/page.tsx`** (1,485 → 1,041 lines) —
  removed `<ManifestActionBar />` (finding #3) and `<AutoActionStrip />`
  (finding #4) with documented rationale left in place as a code comment;
  removed the dead "Entity Domain Actions" panel + its `useRunArtifact`/
  `useLensData('entity','entity',...)` plumbing (finding #2, now closed by
  the workbench's Analyze tab) and the three now-relocated result-render
  functions; fixed the Terminal mutation's request routing and honest
  result-rendering (finding #1). Net: `Network`, `ShieldCheck`, `Link2`,
  `XCircle`, `AlertTriangle`, `CheckCircle2` dropped from the icon import
  (no longer used anywhere in the trimmed file).
- **`concord-frontend/components/entity/WikidataSearch.tsx`** — small
  complementary fix, not a defect closure: this component (a live Wikidata
  search that only offered "Save as DTU") sat right below the workbench's own
  Import-tab Wikidata search (which imports as a graph node), reading as two
  disconnected search boxes doing different things. Added an "Add to graph"
  button per result, calling `entity.import-wikidata` directly (the same
  macro the Import tab uses), plus a `window.dispatchEvent(new
  CustomEvent('entity:graph-changed'))` + a matching listener in
  `KnowledgeGraphWorkbench` so the two non-react-query sibling components
  stay in sync without a shared store. "Save as DTU" and "Add to graph" are
  now clearly complementary (citable note vs. live graph node), not
  redundant.

## Verification

- `cd concord-frontend && npx eslint app/lenses/entity/page.tsx
  components/entity/KnowledgeGraphWorkbench.tsx
  components/entity/WikidataSearch.tsx components/entity/EntityCard.tsx` —
  clean, exit 0.
- Manual type read-through in place of a full-project `tsc` (avoided to not
  race sibling agents editing other lenses concurrently in the same working
  tree): verified `MergeSplitTab`'s new `prefill?: {sourceId,targetId} |
  null` / `onPrefillConsumed?: () => void` props against their call site;
  verified `AnalyzeTab`/`DuplicatesPanel`/`CentralityPanel`/`ValidatePanel`
  prop and state types line up with `GraphState`/`GraphNode`/`GraphEdge`/
  `EntitySchema`/`AttrEntry` (all pre-existing interfaces in the same file);
  verified the three new result interfaces (`ResolutionResult`,
  `RelGraphResult`, `ValidationResult`) match the macros' actual returned
  field names by re-reading `server/domains/entity.js`'s return statements
  directly (not assumed); confirmed `apiHelpers.lens.runDomain`'s untyped
  (`any`) response shape doesn't regress the Terminal mutation's existing
  loose typing.
- `node scripts/lens-unsurfaced.mjs --lens entity` → `entity: 0/18 macros
  never referenced in the frontend` (unchanged — the script couldn't see the
  fixed reachability gaps to begin with; the fix is validated by finding #1/#2
  above, not by this script's number moving).
- `cd server && node --test tests/entity-domain-parity.test.js
  tests/entity-lock.test.js tests/entity-power.test.js` → **35/35 passing, 0
  fail** (no backend files were touched — this pass is frontend-only, so
  these numbers were expected to hold and did).
- Fabrication re-grep: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|
  lorem\|hardcoded" app/lenses/entity/page.tsx components/entity/*.tsx` — no
  hits, before or after (this lens's defect class was dead-wiring and
  broken-generic-scaffolding, not fabricated data).
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
