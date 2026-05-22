# dtus — Feature Gap vs knowledge-base browser (internal)

Category leader (2026): no direct consumer rival — internal substrate utility. Closest analog: a knowledge-graph / note browser (Obsidian graph, Roam) over the DTU corpus. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `dtus` domain macros (lineageAnalysis, qualityScore, citationNetwork, tierRecommendation, duplicateDetection) + `/api/dtus` REST list.

## Has (verified in code)
- DTU browser — virtualized list, detail view, quick-create
- Live DTU feed; trending DTUs panel; domain probe card
- AI actions: lineage analysis, quality score, citation network, tier recommendation, duplicate detection

## Missing — buildable feature backlog
- [x] `[M]` Citation graph visualization — interactive node-link map of DTU lineage
- [x] `[M]` Faceted search/filter — by layer, tier (regular/MEGA/HYPER), scope, quality, tags
- [x] `[S]` Lineage tree view — drill MEGA → originals and HYPER → MEGAs
- [x] `[S]` Bulk operations — multi-select for tag, cite, tier, or archive
- [x] `[M]` Side-by-side DTU compare / duplicate-merge UI (detection exists; merge does not)
- [x] `[S]` Saved views / smart collections over the corpus
- [x] `[S]` Inline 4-layer editor (human/core/machine/artifact) in the detail view

## Parity
~88% of a knowledge-graph browser. List, detail, quick-create, feed, and AI analysis are real, but missing the citation-graph visualization, faceted search, lineage tree, and bulk/merge tools that make a large corpus navigable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
