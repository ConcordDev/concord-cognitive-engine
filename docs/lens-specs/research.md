# research — Feature Gap vs Obsidian / Elicit

Category leader (2026): Obsidian (linked notes) + Elicit (research assistant). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/research.js` — ~33 macros: note CRUD, daily note, templates, backlinks, notes search, references CRUD + status, reading queue, tags, collections, reference relations, annotations, citation formatting, bibliography build, library stats, LLaVA vision, citation network, methodology score, reproducibility check.

## Has (verified in code)
- Note CRUD with backlinks, daily note, templates, full-text notes search
- Reference manager: add/list/detail/update/delete, reading status, reading queue, tags
- Collections of references; reference-to-reference relations; per-reference annotations
- Citation formatting + bibliography build; library stats
- Citation network analysis, methodology scoring, reproducibility check, LLaVA vision
- ResearchLibrarySection component

## Missing — buildable feature backlog
- [ ] `[M]` Graph view — visualize the backlink network of notes (Obsidian's signature)
- [ ] `[M]` LLM literature review — extract findings across many papers into a comparison table (Elicit core)
- [ ] `[S]` PDF attachment + annotation for references
- [ ] `[M]` Live academic search — query Semantic Scholar / OpenAlex / arXiv inside the lens
- [ ] `[S]` Inline [[wikilink]] autocomplete in the note editor
- [ ] `[S]` Canvas / spatial board for arranging notes
- [ ] `[S]` Snapshot/version history per note

## Parity
~60% of Obsidian+Elicit's feature surface. The note + reference + backlink + collection model is genuinely strong, plus citation tooling and methodology/reproducibility analysis. Gaps are the graph view, LLM-driven literature synthesis, and live academic search.
