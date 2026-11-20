# Graph Lens — Capability Map (three-column, LENS REWORK format)

> Reworked 2026-10-28 (PR #1706 rework). Competitor frame per the
> Research inventory filed 2026-10-28 (Obsidian Graph View on top,
> Kumu for import/export, Neo4j Bloom for inspector/analytics) and the
> rework handoff's 13-flow acceptance list. New/changed rows are
> marked "(this rework)" and are behaviour-tested in this PR; per the
> Concord Standard they count as closed only on Product Review 2's
> live pass / re-review, not on this document's say-so.
>
> Backend inventory: `server/domains/graph.js` now registers **34
> macros** (28 before this rework + map-update, edge-update,
> map-import, map-orphans, map-undo-delete, verify-dtu, and
> node-update's typed properties). Maps are per-user STATE-backed; heavy analytics
> (clusterDetect, graphMetrics, layout) run server-side, off the
> browser's main thread by construction.

| Feature (Obsidian / Kumu / Bloom) | 1. Have, and works live | 2. Have in backend, not surfaced or broken | 3. Missing |
|---|---|---|---|
| Create a map, then rename / describe it | **Yes** — `map-update` + inline editor in the Mind Map Builder (this rework) | | |
| Add nodes and edges; edit an edge's label AND type, persisted | **Yes** — `edge-update`; `edge-add` takes a type; edges render their type chip (this rework) | | |
| Typed node properties (Bloom inspector) | **Yes** — `node-update` props merge (string/number/boolean, null removes a key) + the per-node Properties editor (this rework) | | |
| Import nodes/edges (Kumu) | **Yes** — `map-import`: CSV (label,notes + an edges section) and JSON (nodes + edges by label), per-row errors reported and shown, 1,000-node / 1,000-edge row caps, optional target map (re-import merges instead of duplicating) (this rework) | | XLSX/spreadsheet-file import |
| Orphan / unlinked-node view (Obsidian) | **Yes** — `map-orphans` (computed from the real edge list) + the builder's Unlinked panel (this rework) | | |
| Undo a node/edge deletion | **Yes** — deletes stash into a bounded per-map trash; `map-undo-delete` restores a node with its edges, an edge when both endpoints live (this rework) | | |
| Verify a DTU's integrity from its dialog | **Yes** — `verify-dtu` runs the dtu-integrity hash + signature chain and reports verified / tampered / not-yet-anchored; DTU Sync validates the id at link time (this rework) | | |
| Local graph centred on a node, depth slider | **Yes** — `local-graph` + the field/explore views (pre-existing, verified in L3) | | |
| Search a node and centre on it | **Yes** — field search + recenter (pre-existing) | | |
| Saved filters — save, list, re-apply, delete | **Yes** — `filter-save/list/apply/delete` wired in the parity panel (pre-existing) | | |
| Colour group rules | **Yes** — `group-rules-set/get` wired (pre-existing) | | |
| Cluster detection + metrics with progress/timeout path | **Yes** — `clusterDetect` / `graphMetrics` / `map-metrics` run server-side (no main-thread blocking); the panels show busy state while they run (pre-existing wiring; server-side execution is this lens's answer to the worker requirement) | | |
| Merge two nodes, lineage kept | **Yes** — `map-merge-nodes`: edges re-pointed and deduped, losing node's notes + mergedFrom provenance recorded on the survivor (pre-existing, server-verified) | | |
| Export the view | **Yes** — `export-view` produces real SVG + JSON server-side; PNG added as a client raster of that same SVG (this rework) | | |
| Path between two nodes | **Yes** — `pathFind` + the builder's "How are these connected?" (pre-existing) | | |
| Save a map as a DTU / draft it in Thread | **Yes** — the map report menu's read-back-verified Keep chain (pre-existing) | | |
| Physics controls (forces, arrows, label toggles) | | **Present in the field/explore views; persistence of view settings across reload is not proven** — Product's live pass settles this row | |
| Sharing / collaborating on a map | | **Backend boundary, not a UI gap** — maps live in the owner's STATE with no ACL; cross-account access is an access-model change (NEEDS-RAMAJ), not built here | |
| Real-time co-editing (Kumu's known weakness too) | | | **Missing** |
| Presentations / published views (Kumu) | | | **Missing** |

**Counts: 19 rows mapped — 15 have-and-works (6 of them added by this
rework), 2 have-in-backend-unsurfaced-or-unproven, 2 missing.**

Deliberately NOT built (stated, not faked): map sharing (access-model
change, NEEDS-RAMAJ); a Web Worker for layout/metrics (the compute
already runs server-side — a worker would duplicate it); XLSX import
(CSV/JSON cover the acceptance flows).

## 2026-11-20 — The Star Chart redesign

The lens is one app, `components/graph/sky/Observatory.tsx` (page.tsx re-exports it), following `docs/LENS_REDESIGN_PLAYBOOK.md`. One graph: the shared lattice drawn as a sky, with your maps drawn over it as your own constellations. Rooms: The sky, Chart room.

**Security fixed: a graph map could rewrite anyone's DTU.**
- `link-node-dtu` accepted any existing DTU id. `node-update` and `sync-to-dtu` then wrote the node's label and notes into that DTU's title and content. That covered other people's published work and seed knowledge.
- Now a map may link only a DTU the user can see; someone's private DTU answers like a missing id.
- It writes only to a DTU the user authored (`sync-to-dtu` refuses, `node-update` stays map-only).
- Map convergence no longer writes map lines onto other people's DTUs, and prunes those an earlier version wrote.
- Pinned in `server/tests/graph-domain-parity.test.js` and `server/tests/graph-maps-convergence.test.js`.

**Lattice fixed: missing lineage edges.** `dtu.create` keeps lineage as a bare array when given `lineage: [...]`, but the graph index only read `lineage.parents`. Every such child was missing its edge in the force graph, search neighbourhoods and all graph views. The index now reads both shapes.

**Added** (`server/lib/star-chart.js`, plus macros in server.js):
- **`graph.sky`** — every chartable DTU the viewer may see, brightest first:
  - magnitude = 6 − 2.5·log10(1 + links + 2·citations);
  - class from the shelf, with personal records and system rows never charted;
  - constellations by deterministic Louvain, named for their brightest star;
  - a stable seeded layout;
  - `include` charts named stars, such as your own map notes (class D, owner only).
- **`graph.star`** — the catalogue card, with lineage replacing the Genome view (which was mounted with no data and always empty).
- **`graph.route`** — the shortest path over links, never through a star the viewer can't see.
- **`graph.my-constellations`** — your maps, drawn between the stars their nodes link to.
- `sky`, `star` and `route` are public reads; visibility is enforced per star.

**Retired:**
- GraphField and the 2,000-line Bloom explorer, both replaced by the sky. The explorer's "Add node" showed a fake `local-…` id that was never reconciled and wrote a duplicate entity artifact. Its analysis lives on as the Survey, using the same macros over the charted stars.
- GitHub graph-tooling search (off-purpose, owner's call).
- KnowledgeGenomeBrowser.
- GraphField's three tests, superseded by `concord-frontend/tests/graph-star-chart.test.tsx`.

**Tests:** `server/tests/star-chart.test.js` (pure rules), `server/tests/depth/graph-star-chart-behavior.test.js` (through the server: privacy, card lineage, routes, your constellations, determinism), `concord-frontend/tests/graph-star-chart.test.tsx`.

**Browser drive** (two people, signed out, phone):
- **Sky:** Ada's 12 linked DTUs charted in 3 constellations. Statics showed magnitude 4.25 from its 4 links; Ben's private child was neither shown nor counted.
- **Card and route:** search pointed the telescope and opened the card with its lineage. A route Statics → Columns → Footings → Soil mechanics plotted 3 jumps.
- **New star:** "New star from here" made a linked DTU. If the DTU council refuses a thin idea, the card shows its reason.
- **Survey:** ran over exactly the 15 stars and 10 links charted.
- **Your chart:** Ada's map drew as her own constellation.
- **Signed out:** saw only public stars (none in that DB).
- **Phone:** no sideways scroll.
