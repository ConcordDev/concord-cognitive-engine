# graph — Feature Gap vs Obsidian (graph view) / Kumu

Category leader (2026): Obsidian graph view / Kumu (network mapping). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `graph` domain — nodeAnalysis, pathFind, clusterDetect, graphMetrics, map CRUD, node CRUD, edge add/delete, map-metrics, dashboard; InteractiveGraph + KnowledgeSpace3D + MindMapBuilder + FractalEmpireExplorer components; reads DTU lattice.

## Has (verified in code)
- Interactive 2D graph of nodes/edges with zoom/pan, node-type coloring (regular/mega/hyper/shadow + media types)
- 3D knowledge-space view; mind-map builder; fractal-empire explorer
- Graph maps CRUD — create/list/detail/delete; node + edge CRUD
- Graph analytics — node analysis, pathfinding, cluster detection, graph metrics, map metrics
- DTU lattice integration; search, filter, play/pause force simulation, export

## Missing — buildable feature backlog
- [ ] `[S]` Local graph view — neighborhood of a single node at adjustable depth
- [ ] `[M]` Saved graph filters / query language (Obsidian's filter groups)
- [ ] `[S]` Node grouping by color rules + custom group definitions
- [ ] `[M]` Timeline scrubber — animate graph growth over time
- [ ] `[S]` Bidirectional sync — edits in graph update the underlying DTUs
- [ ] `[M]` Auto-layout algorithms (hierarchical, radial, circular) beyond force
- [ ] `[S]` Export as image/SVG with current view state

## Parity
~70% of Obsidian's graph-view feature surface. Multiple visualization modes (2D/3D/mind-map/fractal), real graph analytics, and lattice integration make this strong, but it lacks local-graph focus, saved filter groups, a timeline scrubber, and alternative layouts.
