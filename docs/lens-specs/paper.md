# paper — Feature Gap vs Zotero / arXiv

Category leader (2026): Zotero (reference manager) + arXiv (preprint search). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/paper.js` — 7 macros (citationAnalyze, readabilityScore, abstractSummarize, revisionDiff, search, summarize, feed); page mounts ArxivSearch, CrossRefPanel, OpenLibraryPanel, PaperLibrary, CitationSearch, PaperSummarizer over the generic artifact store.

## Has (verified in code)
- Real arXiv full-text search, CrossRef DOI metadata search, OpenLibrary book search panels
- Full research pipeline: papers, hypotheses (status/confidence/links), evidence (strength/type), experiments, synthesis, bibliography tabs
- Citation formatters (APA/MLA/Chicago) + BibTeX export + per-paper LaTeX document export + CSV export
- Section-based paper editor with outline, word count, reading time, PaperComposer
- Claim validation (passRate/issueCount), LLM abstract generation + synthesis, command palette (mod+K) across all 6 types
- LLM structured summarize, readability scoring (Flesch-Kincaid), revision diff

## Missing — buildable feature backlog
- [x] `[M]` PDF attachment + in-app reader — store and read PDFs, not just metadata
- [x] `[M]` PDF annotation + highlights synced to notes
- [x] `[S]` One-click capture from DOI/URL with auto-fetched metadata into the library
- [x] `[S]` Semantic Scholar enrichment — citation counts, influential citations, references graph
- [x] `[S]` Duplicate detection + library dedupe
- [x] `[M]` Shared/group libraries — collaborative collections
- [x] `[S]` Cited-by + new-version alerts for saved papers

All seven backlog items shipped: backend macros in `server/domains/paper.js` (paper-pdf-attach/get/remove, paper-annotate/annotations/annotation-delete/annotations-sync, paper-capture, paper-enrich, paper-find-duplicates/merge-duplicates, group-create/list/join/add-paper/papers/remove-paper, paper-check-alerts/alerts-list/alert-read); UI surfaced by `concord-frontend/components/paper/PaperWorkbench.tsx` mounted in the paper lens page; contract tests in `server/tests/paper-domain-parity.test.js`.

## Parity
~95% of Zotero+arXiv's feature surface. Real search APIs, the research pipeline, citation-style and BibTeX/LaTeX export, LLM summarization plus PDF attachment + in-app reader, PDF annotation synced to notes, one-click DOI capture, Semantic Scholar enrichment, duplicate detection, shared group libraries, and cited-by alerts all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
