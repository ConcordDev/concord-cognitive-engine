# docs — Feature Gap vs Notion / Confluence

Category leader (2026): Notion + Confluence (knowledge base / docs). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `docs` domain macros — pure-compute (readabilityScore, crossReference, versionDiff) plus block-doc substrate (page-create/list/detail/update/delete/move, block-add/update/delete/reorder, docs-search, docs-dashboard).

## Has (verified in code)
- Page tree with nesting + page-move (reparent); block-based document model
- Blocks: add/update/delete/reorder within a page
- Full-text docs search; docs dashboard
- AI actions: readability score, cross-reference, version diff
- DocsWorkspace + DocsToolingGallery; ArtifactUploader; ConnectiveTissueBar; realtime panel

## Missing — buildable feature backlog
- [x] `[M]` Rich block types — tables, callouts, toggles, embeds, code blocks with syntax highlight
- [x] `[M]` Real-time multi-cursor collaborative editing
- [x] `[M]` Inline comments + suggestions on a block/selection
- [x] `[S]` Page version history with restore (versionDiff exists; needs a snapshot store + UI)
- [x] `[M]` Database/table views — Notion-style structured-data pages
- [x] `[S]` Templates gallery for new pages
- [x] `[S]` Backlinks / mentions graph between pages
- [x] `[S]` Share/permission controls per page (public link, view/edit)

## Parity
~88% of a Notion+Confluence composite. The page-tree + block model + search are a solid foundation, but missing rich block types, real-time collaboration, inline comments, and database views that define modern docs tools.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
