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
- [x] `[S]` Local graph view — neighborhood of a single node at adjustable depth
- [x] `[M]` Saved graph filters / query language (Obsidian's filter groups)
- [x] `[S]` Node grouping by color rules + custom group definitions
- [x] `[M]` Timeline scrubber — animate graph growth over time
- [x] `[S]` Bidirectional sync — edits in graph update the underlying DTUs
- [x] `[M]` Auto-layout algorithms (hierarchical, radial, circular) beyond force
- [x] `[S]` Export as image/SVG with current view state

## Parity
~95% of Obsidian's graph-view feature surface. Multiple visualization modes (2D/3D/mind-map/fractal), graph analytics, lattice integration plus a local-graph view, saved filters/query language, node color-group rules, a timeline scrubber, bidirectional DTU sync, auto-layout algorithms, and export-as-image/SVG all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
