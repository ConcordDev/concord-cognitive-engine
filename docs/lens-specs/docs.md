# docs — Feature Completeness Spec

Rival app(s): Notion, Confluence (2026)
Sources:
- https://www.notion.so/ (nested pages, block editor, page tree, slash-menu block types, search)
- https://www.atlassian.com/software/confluence (docs workspace, page hierarchy)

Previously the docs domain was analysis-only (readability, cross-ref,
version diff). This spec covers the new Notion-shape page/block
document substrate.

## Features

### Pages
- [x] Create pages — title + icon, optionally nested under a parent (macro: docs.page-create)
- [x] Page tree — list with parent links (macro: docs.page-list)
- [x] Page detail with all blocks (macro: docs.page-detail)
- [x] Rename + re-icon a page (macro: docs.page-update)
- [x] Delete a page — cascades to descendants (macro: docs.page-delete)
- [x] Move a page under a new parent — self-parent guarded (macro: docs.page-move)

### Block editor
- [x] 11 block types — paragraph, heading 1/2/3, bulleted/numbered list, to-do, code, quote, callout, divider (macro: docs.block-add)
- [x] Insert a block after another (macro: docs.block-add afterId)
- [x] Edit block text / type / to-do checked state (macro: docs.block-update)
- [x] Reorder + delete blocks (macro: docs.block-reorder / block-delete)

### Search & overview
- [x] Workspace search across page titles + block content (macro: docs.docs-search)
- [x] Dashboard — pages, blocks, words, open/done to-dos (macro: docs.docs-dashboard)

### Document analysis (retained)
- [x] Readability scoring — 7 indices (macro: docs.readabilityScore)
- [x] Cross-reference graph — broken links, orphans, cycles, PageRank (macro: docs.crossReference)
- [x] Semantic version diff with move detection (macro: docs.versionDiff)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Notion databases (table/board/gallery views) | a typed-property schema engine | nested pages + 11 block types; to-do blocks cover lightweight task tracking |
| Real-time collaborative editing | a CRDT/OT sync server | per-user workspace; block-level macros keep edits granular |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/docs.js` clean. 14 macros
  (3 analysis + 11 page/block substrate).
- 2026-05-20: Tests — `tests/docs-domain-parity.test.js` 11/11 green
  (page CRUD + per-user scope + nested cascade-delete + self-parent reject /
  typed blocks + unknown-type fallback + afterId insert + todo toggle +
  reorder + delete / search title+content / dashboard / analysis intact).
- 2026-05-20: Frontend — new `DocsWorkspace` (nested page tree + inline
  block editor for all 11 types, search) mounted in the docs lens page.
  `npx tsc --noEmit` exit 0.
