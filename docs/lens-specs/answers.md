# answers — Feature Completeness Spec

Rival app(s): Stack Overflow, Quora (2026)
Sources:
- https://stackoverflow.com/ (ask, answer, vote, accept, comment, tags, bounties, reputation)
- https://www.quora.com/ (questions, answers, topics, search)
- https://api.stackexchange.com/ (live public Q&A search — used by `StackOverflowSearch`)

Previously a SCAFFOLD (UI shell, no backend). This spec covers the new
`server/domains/answers.js` Q&A backend wired to the existing lens page.

## Features

### Questions
- [x] Ask a question — title / body / tags, with length validation (macro: answers.question-ask)
- [x] List questions — filter by tag / query, filter unanswered / accepted / bountied, sort newest / votes / active / answers (macro: answers.question-list)
- [x] Question detail — increments views, accepted answer surfaced first (macro: answers.question-detail)
- [x] Delete a question (macro: answers.question-delete)

### Answers
- [x] Post an answer (macro: answers.answer-post)
- [x] Delete an answer (macro: answers.answer-delete)
- [x] Accept / un-accept an answer — author-only, +15 reputation (macro: answers.answer-accept)

### Voting & reputation
- [x] Vote up / down on questions (+5) and answers (+10), idempotent toggle (macro: answers.vote)
- [x] Reputation ledger with badge tiers — newcomer / contributor / established / trusted (macro: answers.user-reputation)

### Discussion & curation
- [x] Comments on questions and answers (macro: answers.comment-add)
- [x] Tag hub — per-tag question + answered counts (macro: answers.tag-list)
- [x] Bounties — spend reputation to attract answers, auto-awarded on accept (macro: answers.bounty-start)

### Search
- [x] Weighted in-workspace search — title > tag > body > answer hits (macro: answers.search)
- [x] Live public Q&A search via api.stackexchange.com (frontend `StackOverflowSearch`)
- [x] Workspace dashboard — question / answer / view / bounty / reputation counts (macro: answers.dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| A global shared Q&A site | a multi-tenant question store + identity graph | per-user Q&A workspace (consistent with music / message lens domains); live public questions surface through the Stack Exchange API panel |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/answers.js` clean. 14 macros.
  Registered in `domains/index.js` + `ALL_LENS_DOMAINS`; loader smoke confirms
  all 14 `answers.*` macros register.
- 2026-05-20: Tests — `tests/answers-domain-parity.test.js` 12/12 green
  (ask validation / list filter+sort / detail views + accepted-first /
  accept reputation +15 toggle / vote +10 +5 idempotent / tags / search
  ranking / bounty reputation gate / dashboard).
- 2026-05-20: Frontend — new `AnswersQA` workbench (list / detail / ask views,
  vote rails, accept, comments, bounty) mounted in the answers lens page above
  the live Stack Exchange search. `npx tsc --noEmit` exit 0.
