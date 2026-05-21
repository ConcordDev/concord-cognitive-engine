# paper — Feature Gap vs Zotero / arXiv

Category leader (2026): Zotero (reference manager) + arXiv (preprint search). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/paper.js` — 13 macros: real arXiv search, LLM paper summarize, citation analysis, readability scoring, extractive abstract summarizer, revision diff, per-user paper library + collections (Zotero-shape) with status/rating/tags/notes, library dashboard, Crossref new-works DTU feed.

## Has (verified in code)
- Real arXiv full-text search; Crossref latest-works feed; OpenLibrary panel; citation search component.
- Paper library with to_read/reading/read status, 1–5 rating, tags, notes, named collections, dashboard counts.
- LLM structured summarize (problem/approach/results/limitations/why-it-matters/keyTerms).
- Citation analysis (self-cite rate, recency index, type/year breakdown), readability (Flesch-Kincaid/Fog), extractive abstract summary, revision diff.

## Missing — buildable feature backlog
- [ ] `[M]` PDF attachment + reader — store PDFs and read/annotate in-app.
- [ ] `[M]` Citation export — BibTeX/RIS/CSL export and copy-as-citation in named styles (APA/MLA/Chicago).
- [ ] `[M]` One-click capture from DOI/URL — save a paper with auto-fetched metadata.
- [ ] `[S]` Semantic Scholar enrichment — citation counts, influential citations, references graph.
- [ ] `[M]` PDF annotation + highlights synced to notes.
- [ ] `[S]` Duplicate detection + library dedupe.
- [ ] `[M]` Shared/group libraries — collaborative collections.
- [ ] `[S]` Reading-progress + cited-by alerts for saved papers.

## Parity
~55% of Zotero+arXiv's feature surface. Genuinely strong: real search, a proper library model, and LLM summarization. Gaps are the librarian essentials — PDF storage/reader, citation-style export, and one-click web capture.
