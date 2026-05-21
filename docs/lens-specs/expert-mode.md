# expert-mode — Feature Gap vs Perplexity

Category leader (2026): Perplexity. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `expert_mode` domain macros (answer, sources_preview, extract_citations) backed by `server/lib/expert-mode.js`; routes through brainChat() so BYO API keys apply; records royalty-cascade citations per source.

## Has (verified in code)
- Cited-answer surface: query box → numbered answer with `[N]` markers rendered as clickable chips that scroll to source rows
- Numbered source list with provenance ("via Claude / GPT / Grok / Gemini") provider badges
- Sources preview macro — shows "about to consult N sources" before committing the brain call
- BYO-provider routing per brain slot; citation-count → royalty credits to DTU creators
- BrainPoolStatus + AnswerActionPanel components

## Missing — buildable feature backlog
- [ ] `[M]` Follow-up / threaded conversation — Perplexity keeps context across turns; this is single-shot
- [ ] `[M]` Live web search integration alongside the DTU corpus (corpus is the only source)
- [ ] `[S]` Focus modes — Academic / Writing / Math / Video scoping of sources
- [ ] `[M]` "Pages" / Spaces — save answers into shareable collections
- [ ] `[S]` Related-questions suggestions after each answer
- [ ] `[M]` File/PDF upload as a query source
- [ ] `[S]` Answer export (copy as markdown, share link)

## Parity
~45% of Perplexity's feature surface. The citation chip + provenance + royalty mechanic is genuinely novel, but it lacks threaded follow-ups, live web search, focus modes, and Spaces — the conversational research loop Perplexity is built around.
