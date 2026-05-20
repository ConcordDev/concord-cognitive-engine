# home-improvement — Feature Completeness Spec

Rival app(s): Houzz, HomeZada, Angi (2026)
Sources:
- https://www.saferproducts.gov/ — U.S. Consumer Product Safety Commission recall API (free, no key)

## Features

### Planning calculators
- [x] Project cost estimate, ROI calculator, permit check, colour palette

### Renovation-project substrate (new)
- [x] Projects — name, room, budget, status (macro: home-improvement.project-add / project-list / project-status / project-delete)
- [x] Tasks per project with completion toggle (macro: home-improvement.task-add / task-toggle)
- [x] Expense log — materials / labor / permit / tools, with budget tracking (macro: home-improvement.expense-log)
- [x] Dashboard — projects, budget vs spent, task progress (macro: home-improvement.home-improvement-dashboard)

### Live data & feed
- [x] Live product-recall feed — CPSC consumer-product recalls (tools, ladders, appliances) ingested as DTUs (macro: home-improvement.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Contractor marketplace + bidding | a vetted-pro network | the `marketplace` lens carries listings |

## Verification log
- 2026-05-20: Backend — built from a 4-macro stub: kept 4 calculators, added an 8-macro project substrate + `feed` (CPSC → DTUs). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` home-improvement substrate + feed + calculator-intact cases green.
- 2026-05-20: Frontend — `LensFeedButton domain="home-improvement"` mounted in the lens page.
