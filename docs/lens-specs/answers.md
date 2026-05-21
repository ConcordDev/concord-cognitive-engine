# answers — Feature Gap vs Stack Overflow

Category leader (2026): Stack Overflow. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/answers.js` — 15 macros: question-ask/list/detail/delete, answer-post/delete/accept, vote, comment-add, tag-list, bounty-start, search, user-reputation, dashboard, feed.

## Has (verified in code)
- Ask question (title/body/tags, length validation); post + delete answers
- Accept/un-accept answer (author-only, +15 rep); up/down voting (idempotent toggle)
- Comments on questions and answers; tag hub with per-tag counts
- Bounties (spend reputation, auto-award on accept); reputation ledger + badge tiers
- Weighted in-workspace search (title > tag > body > answer); workspace dashboard
- Live public Q&A search via Stack Exchange API panel
- The Answers framework viewer: 30 curated hard-problem cards with equations + Oracle elaboration

## Missing — buildable feature backlog
- [ ] `[M]` Rich markdown + code-block editor with syntax highlighting in answers
- [ ] `[S]` Question/answer edit history with revision diff
- [ ] `[M]` Duplicate-question detection + linking via embedding similarity
- [ ] `[S]` Privilege tiers gating actions at reputation thresholds
- [ ] `[M]` Tag-watch / question subscription + notifications
- [ ] `[S]` Related-questions sidebar
- [ ] `[S]` Answer-quality flags / close-vote / community moderation queue

## Parity
~65% of Stack Overflow's Q&A surface. The ask/answer/vote/accept/bounty/reputation loop is complete and real; gaps are editor richness, revision history, and the moderation/curation tooling that keeps SO clean.
