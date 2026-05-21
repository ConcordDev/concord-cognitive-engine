# expert-mode — Feature Gap vs Perplexity Pro

Category leader (2026): Perplexity Pro / ChatGPT with search. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `expert_mode` domain macros (answer, sources_preview, extract_citations) routed to multi-brain pool; calls `POST /api/lens/run`.

## Has (verified in code)
- Cited-answer generation against the DTU corpus (`answer` macro, source-grounded)
- Sources preview before answering (`sources_preview`)
- Citation extraction (`extract_citations`)
- BrainPoolStatus component — shows which of the 4 brains/BYO-key providers served the answer
- AnswerActionPanel — follow-up actions on a returned answer
- Provider/model badge (claude/gpt/grok/gemini) on answers

## Missing — buildable feature backlog
- [ ] `[M]` Streaming token-by-token answer rendering (currently appears to be request/response)
- [ ] `[M]` Follow-up / conversational thread — multi-turn with retained context
- [ ] `[S]` Inline source citations clickable to the exact passage
- [ ] `[M]` Focus modes — scope search to academic / news / code / DTU-only
- [ ] `[M]` "Pro Search" multi-step planner that decomposes a question into sub-queries
- [ ] `[S]` Related-questions suggestions after each answer
- [ ] `[M]` Spaces / collections — save answer threads into named research projects
- [ ] `[S]` Image and file upload as query context

## Parity
~45% of Perplexity Pro. Core cited-answer + multi-provider routing is genuinely there, but it is single-shot Q&A — no conversation threading, no streaming, no focus modes, no multi-step planning.
