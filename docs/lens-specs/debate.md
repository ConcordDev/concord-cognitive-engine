# debate — Feature Completeness Spec

Rival app(s): Kialo, Change My View (2026)
Sources:
- https://www.kialo.com/ (thesis-rooted pro/con argument trees, claim impact voting, nested counter-claims)
- r/changemyview (structured debate)

Previously the debate domain was analysis-only (evaluate, steelman,
score, fallacy-check). This spec covers the new Kialo-shape argument-
tree substrate.

## Features

### Debates & argument trees
- [x] Create a debate from a thesis (macro: debate.debate-create)
- [x] List debates with claim counts + live support score (macro: debate.debate-list)
- [x] Debate detail — full claim tree + score (macro: debate.debate-detail)
- [x] Delete a debate (macro: debate.debate-delete)
- [x] Add pro / con claims, nested under the thesis or any claim (macro: debate.claim-add)
- [x] Edit a claim's text + stance (macro: debate.claim-edit)
- [x] Delete a claim — cascades to sub-claims (macro: debate.claim-delete)

### Scoring & voting
- [x] Impact voting on claims, 1-5 weight, running average (macro: debate.claim-vote)
- [x] Recursive tree scoring — claim strength modulated by pro/con balance of its children; thesis support % + verdict
- [x] Debate dashboard — debates, claims, well-supported count (macro: debate.debate-dashboard)

### Argument analysis (retained)
- [x] Evaluate an argument (macro: debate.evaluateArgument)
- [x] Steelman a position (macro: debate.steelmanPosition)
- [x] Score a debate (macro: debate.scoreDebate)
- [x] Fallacy check (macro: debate.fallacyCheck)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Multi-user collaborative debates | a shared claim store + identity graph | per-user argument trees (consistent with other lens domains); claim impact voting models crowd weight |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/debate.js` clean. 12 macros
  (4 analysis + 8 argument-tree substrate).
- 2026-05-20: Tests — `tests/debate-domain-parity.test.js` 11/11 green
  (debate CRUD + per-user scope / claim tree nest + unknown-parent reject /
  cascade delete / claim edit / scoring pro-up con-down + balanced-50 /
  vote-weighted score / dashboard / analysis intact).
- 2026-05-20: Frontend — new `DebateTree` (thesis + recursively-nested
  pro/con claim tree, impact voting, live support bar) mounted in the debate
  lens page. `npx tsc --noEmit` exit 0.
