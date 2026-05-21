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
- [ ] `[M]` PDF attachment + in-app reader — store and read PDFs, not just metadata
- [ ] `[M]` PDF annotation + highlights synced to notes
- [ ] `[S]` One-click capture from DOI/URL with auto-fetched metadata into the library
- [ ] `[S]` Semantic Scholar enrichment — citation counts, influential citations, references graph
- [ ] `[S]` Duplicate detection + library dedupe
- [ ] `[M]` Shared/group libraries — collaborative collections
- [ ] `[S]` Cited-by + new-version alerts for saved papers

## Parity
~60% of Zotero+arXiv's feature surface. Genuinely strong: real search APIs, a full research pipeline, working citation-style and BibTeX/LaTeX export, and LLM summarization. The gaps are the librarian essentials — PDF storage/reader/annotation and one-click web capture.
