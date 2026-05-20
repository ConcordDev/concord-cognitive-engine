# paper — Feature Completeness Spec

Rival app(s): Zotero, Semantic Scholar, Mendeley (2026)
Sources:
- https://www.zotero.org/ (reference library — papers, collections, reading status, notes, tags)
- https://www.semanticscholar.org/ (paper discovery + library)
- live: arXiv, Open Library, CrossRef DOI

`research` is the broader Roam-style knowledge-graph lens; `paper`
is the focused academic-paper reading library.

## Features

### Paper library
- [x] Save a paper — title, authors, year, venue, abstract, DOI, URL; dedupe by refId (macro: paper.paper-save)
- [x] List + filter by status / collection / tag / query (macro: paper.paper-list)
- [x] Paper detail (macro: paper.paper-detail)
- [x] Update — reading status (to-read / reading / read), 1-5 rating, notes, tags (macro: paper.paper-update)
- [x] Delete a paper (macro: paper.paper-delete)

### Collections
- [x] Create collections, list with paper counts (macro: paper.collection-create / collection-list)
- [x] Assign / unassign papers to collections (macro: paper.collection-assign)
- [x] Library dashboard — by reading status, collections, papers with notes (macro: paper.library-dashboard)

### Discovery & analysis (retained)
- [x] Paper search + summarize (macro: paper.search / summarize)
- [x] Citation analysis (macro: paper.citationAnalyze)
- [x] Readability scoring (macro: paper.readabilityScore)
- [x] Abstract summarization (macro: paper.abstractSummarize)
- [x] Revision diff (macro: paper.revisionDiff)
- [x] Live arXiv / Open Library / CrossRef search (frontend panels)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| PDF storage + annotation | a blob store + PDF renderer | per-paper notes field + tags; the lens stores metadata, abstract and reading state |
| Auto-import from a browser connector (Zotero Connector) | a browser extension | save papers from the in-lens arXiv search, or paper-save directly |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/paper.js` clean. 14 macros
  (6 discovery/analysis + 8 library substrate).
- 2026-05-20: Tests — `tests/paper-library-domain-parity.test.js` 7/7 green
  (paper CRUD + per-user scope + dedupe + status filter / collections create-
  assign-unassign + paper count / library dashboard buckets).
- 2026-05-20: Frontend — new `PaperLibrary` (paper list with status select +
  star rating + expandable notes, collections) mounted in the paper lens
  page. `npx tsc --noEmit` exit 0.
