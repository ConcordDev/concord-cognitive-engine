# graph — Feature Completeness Spec

Rival app(s): XMind, MindMeister, Obsidian Graph (2026)
Sources:
- https://xmind.com/ (mind maps — central topic, branches, notes)
- https://www.mindmeister.com/ (browser-native collaborative mind mapping)
- Web search 2026-05-20: central topic + branch nodes, AI branch generation, concept graphs

## Features

### Mind-map / concept-graph builder
- [x] Create a map — auto-seeds a central node, per-user (macro: graph.map-create)
- [x] List / detail / delete maps (macro: graph.map-list / map-detail / map-delete)
- [x] Add nodes — optional parent auto-creates a branch edge (macro: graph.node-add)
- [x] Update node label / notes (macro: graph.node-update)
- [x] Delete a node — cascades its edges; central node protected (macro: graph.node-delete)
- [x] Add free edges between any two nodes — self-loop + duplicate guarded (macro: graph.edge-add)
- [x] Delete edges (macro: graph.edge-delete)
- [x] Map metrics — node/edge counts, average degree, most-connected hub, isolated nodes (macro: graph.map-metrics)
- [x] Graph dashboard — maps, nodes, edges (macro: graph.graph-dashboard)

### Graph analysis (retained)
- [x] Node analysis (macro: graph.nodeAnalysis)
- [x] Path finding (macro: graph.pathFind)
- [x] Cluster detection (macro: graph.clusterDetect)
- [x] Graph metrics (macro: graph.graphMetrics)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Free-form spatial canvas with drag layout | a canvas + DnD layout engine | a hierarchical branch tree rendering (central node → branches); the `whiteboard` lens carries free canvas |
| AI branch generation (XMind Copilot) | a generative model | manual branch authoring; the universal `analyze`/`generate` lens actions cover AI assist |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/graph.js` clean. 14 macros
  (4 analysis + 10 mind-map substrate).
- 2026-05-20: Tests — `tests/graph-mindmap-domain-parity.test.js` 8/8 green
  (map CRUD + central node + per-user scope / node add auto-edge + central
  protected + cascade delete / edges self-loop+dup guards / metrics hub +
  degree / dashboard / analysis macros intact).
- 2026-05-20: Frontend — new `MindMapBuilder` (multi-map, recursive branch
  tree with inline add, degree metrics) mounted in the graph lens page.
  `npx tsc --noEmit` exit 0.
