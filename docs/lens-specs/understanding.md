# understanding — Feature Gap vs Obsidian / RemNote (knowledge synthesis)

Category leader (2026): Obsidian / RemNote (linked knowledge & concept evolution) — no exact rival; closest analog. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `understanding` domain — 16 macros (subject_kinds, evolution_stats, list/browse, compose, recompose, promotion eval, consolidation candidates, lineage).

## Has (verified in code)
- Four-tab surface: Browse, Compose, Evolution, Lineage.
- Browse understandings by subject kind; per-understanding recompose action.
- Compose a new understanding (synthesized, scoped private by default).
- Evolution tab — evolution stats; promotion evaluation and consolidation candidates.
- Lineage tab — ancestry graph of how understandings derive from each other.
- Stats strip with stat cards; detail modal.

## Missing — buildable feature backlog
- [x] `[M]` Graph view of understandings — interactive linked-knowledge graph (Obsidian's signature).
- [x] `[S]` Full-text search across understanding bodies, not just subject-kind filter.
- [x] `[M]` Backlinks / "referenced by" panel per understanding.
- [x] `[S]` Manual linking — relate two understandings beyond auto-derived lineage.
- [x] `[M]` Inline editing of an understanding body, not only recompose-from-scratch.
- [x] `[S]` Tagging and tag-based filtering.
- [x] `[M]` Diff view — see what changed between understanding revisions.
- [x] `[S]` Export an understanding (markdown / DTU pack).

## Parity
~90% of Obsidian/RemNote. The compose/evolve/lineage substrate plus an interactive knowledge graph, full-text search, backlinks, manual linking, inline editing, tagging + tag filtering, revision diffs, and markdown/DTU-pack export all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
