# Graph Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("graph"' server/domains/graph.js
```
→ **27** macros in `server/domains/graph.js`: 4 analysis macros
(`nodeAnalysis`, `pathFind`, `clusterDetect`, `graphMetrics` — real graph
algorithms: Brandes' betweenness centrality, BFS closeness, connected-
components fragmentation, density/diameter/clustering coefficient) plus 23
"mind map" macros (`map-*`, `node-*`, `edge-*`, `map-metrics`,
`graph-dashboard`, `local-graph`, `filter-*`, `group-rules-*`, `timeline`,
`layout`, `sync-to-dtu`, `link-node-dtu`, `export-view`).

**A second, disjoint macro cluster is registered inline in `server.js`**
(`grep -n 'register("graph"\|registerLensAction("graph"' server/server.js`
→ 7 hits): `register("graph","query"/"visualData"/"forceGraph", ...)` (the
`MACROS` registry — real, DTU-graph-backed) and
`registerLensAction("graph","query"/"cluster"/"analyze"/"merge", ...)` (the
`LENS_ACTIONS` registry — a SEPARATE generic node/edge sandbox, distinct
from both the `MACROS` version and from `domains/graph.js`'s macros of
similar names). `node scripts/lens-unsurfaced.mjs --lens graph` only scans
`domains/graph.js` and reported `2/27 never referenced` (`edge-add`,
`graph-dashboard`) — it cannot see this inline cluster at all, so its
"2 unsurfaced" number understated the real gap.

## Which registry actually answers a call matters here

`runMacro(domain, name, ...)` (used by the `/api/graph/*` REST routes) reads
**only** `MACROS.get(domain).get(name)` — confirmed by reading `runMacro`'s
body (`server.js:11678`ish, `const d = MACROS.get(domain); const m =
d.get(name);`, no `LENS_ACTIONS` fallback). `/api/lens/run` (used by
`lensRun()` in the frontend) prefers `LENS_ACTIONS` and falls back to
`MACROS`. So:
- `apiHelpers.graph.query/visual/force` → `/api/graph/*` → `runMacro` →
  the **`MACROS`** `graph.query`/`visualData`/`forceGraph` — the REAL,
  DTU-graph-backed implementations (`GRAPH_INDEX` built from `STATE.dtus`).
  These are genuinely wired (confirmed: `page.tsx` calls all three via
  `useQuery`) and power the actual force-directed DTU visualization.
- The `registerLensAction("graph","query"/"cluster"/"analyze"/"merge", ...)`
  block is a **completely different, unreachable-by-REST** toolkit — only
  callable via `lensRun('graph', 'query'|'cluster'|'analyze'|'merge', ...)`,
  which nothing in the frontend does (confirmed: no `'cluster'`/`'analyze'`/
  `'merge'` action-name string anywhere in `app/lenses/graph/` or
  `components/graph/`).

## Classification (before this pass)

1. **`nodeAnalysis`/`clusterDetect`/`graphMetrics` — real, dead-wired.**
   `page.tsx`'s "Graph Analytics Actions" panel called these via
   `useRunArtifact('graph').mutate({ id: graphArtifacts[0]?.id, action,
   params: {} })` against a `useLensData('graph', 'graph-data', ...)`
   artifact type. **Nothing anywhere creates a `graph-data` artifact** (no
   creation form; `createEntity` in the same file only makes `'entity'`-
   type artifacts) — `graphArtifacts[0]?.id` was permanently `undefined`,
   so all three buttons were permanently disabled in any real deployment.
   Meanwhile the lens already has a real, live 500-node DTU graph loaded
   for the main visualization (`apiHelpers.dtus.paginated` + `graph.visual`
   + `graph.force`) that these exact algorithms could run against.
2. **`pathFind` — real, dead-wired, AND redundant with a better existing
   feature.** Same broken artifact-gating as above, but this lens also has
   a fully-working, real, **client-side** BFS pathfinder (`findPath`,
   `page.tsx:536`) with click-to-select start/end nodes and live path
   highlighting on the canvas — strictly superior UX to the disabled
   button. No fix needed beyond removing the dead duplicate button.
3. **`edge-add` (confirmed genuinely unsurfaced by the script) /
   `edge-delete` (not flagged, but equally unreachable) —
   `MindMapBuilder.tsx`'s `node-add` only ever creates a tree edge
   (parent→branch); there was no way to add a manual cross-link between two
   already-placed nodes (Obsidian/XMind's "free edge" concept, which the
   component's own header comment already claims: "a central topic with
   branch nodes and **free edges**"), and no way to view or delete any
   edge on its own.
4. **`graph-dashboard` (confirmed genuinely unsurfaced) —** a small
   "maps/nodes/edges across all your mind maps" summary macro with zero
   caller.
5. **`registerLensAction("graph","query"/"cluster"/"analyze", ...)`** (the
   server.js inline block) — genuinely redundant with, respectively: the
   live node search bar, the client-side k-centroid cluster-coloring view
   (`assignClusters`, a different but complementary analysis to
   `clusterDetect`'s connected-components), and the now-fixed
   `graphMetrics`/`nodeAnalysis`. Not worth building a third UI for.
6. **`registerLensAction("graph","merge", ...)`** — a real, unique
   capability (merge two nodes, redirect their edges, dedupe) with no
   analog anywhere else — but it operates on the SAME ungrounded
   `graph-data` artifact sandbox as items 1-2, and (unlike those) can't be
   honestly redirected at the real DTU graph: its mutation
   (`artifact.data = {...}; saveStateDebounced();`) only persists against a
   real, saved artifact, and running it as a virtual artifact (no
   persisted id) would silently discard the "merge" with nothing to show
   for it — wiring it against the real graph would be a fake success, not
   a real fix. **Disposition: GENUINELY MISSING, deferred** — a real "merge
   two DTUs" feature needs backend work this pass didn't do (dedup +
   lineage transfer touching `STATE.dtus` directly, not the artifact
   sandbox); documented here rather than faked.

## What changed

- **`concord-frontend/app/lenses/graph/page.tsx`** — `handleGraphAction`
  rewritten to call `nodeAnalysis`/`clusterDetect`/`graphMetrics` directly
  via `lensRun('graph', action, { nodes, edges })` against the real,
  currently-loaded DTU graph (`graphVisualData`/`graphForceData` — already
  fetched for the visualization) instead of the permanently-empty
  `graph-data` artifact. `POST /api/lens/run` builds a virtual artifact
  whose `.data` **is** the input body (confirmed at `server.js:39566`), so
  no persisted artifact is needed. Removed the redundant, permanently-dead
  `pathFind` button + its now-unreachable result-render branch (the real
  capability lives in the Pathfinder panel).
- **`concord-frontend/components/graph/MindMapBuilder.tsx`** — added a
  "Cross-links" section (list of all edges with delete + a from/to/label
  form calling `edge-add`), and a one-line `{maps} maps · {nodes} nodes ·
  {edges} edges` header stat sourced from `graph-dashboard`.

## Verification

- `server/tests/graph-domain-parity.test.js`,
  `server/tests/graph-mindmap-domain-parity.test.js` — 26/26 pass
  unmodified (no backend macro changed; this was a frontend-wiring-only
  fix).

## Left alone, with reason

- **`GraphParityPanel.tsx` (648 lines)** — read in full; covers ALL of
  `filter-*`, `group-rules-*`, `timeline`, `layout`, `sync-to-dtu`,
  `link-node-dtu`, `export-view`, `local-graph` with real `lensRun` calls.
  No defect found.
- **`GraphRepos.tsx`** — real, small, no defect found.
- **`graph.query`/`cluster`/`analyze` (server.js inline)** — left
  unreferenced by design; redundant with existing real features (see
  classification item 5).
- **`graph.merge`** — genuinely missing real wiring; flagged above as a
  scoped future build (needs backend `STATE.dtus`-level merge logic, not a
  frontend fix), not faked.
