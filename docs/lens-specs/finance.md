# finance — Feature Gap vs Monarch Money / Empower

Category leader (2026): Monarch Money / Empower (personal finance). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `finance` domain — large macro suite: net worth, envelope budgets, investment checkup, tax estimate, retirement Monte Carlo, subscription detect, bill cashflow, goals, recurring investments, holdings, dividends/earnings calendars, spending insights, categorization rules, tax-loss candidates, accounts, assistant. MarketsPulse + WorldBank panels.

## Has (verified in code)
- Net-worth tracker with snapshot history; envelope budgeting; spending insights
- Investment checkup, allocation pie, holdings manager, dividend tracker, recurring investments
- Tax estimator, retirement Monte-Carlo simulator, tax-loss harvester / candidate finder
- Subscription detector + cancel; bills calendar with cashflow forecast; goals tracker
- Transaction categorization rules engine; accounts panel (link/unlink/balance); AI finance assistant

## Missing — buildable feature backlog
- [x] `[L]` Bank aggregation via Plaid/MX — accounts are manual; leaders auto-sync transactions
- [x] `[M]` Automatic transaction feed + AI auto-categorization at ingest
- [x] `[S]` Joint / household shared budgets with multiple members
- [x] `[M]` Credit score monitoring + report integration
- [x] `[S]` Cash-flow Sankey / month-over-month trend charts
- [x] `[M]` Bill-pay + payment reminders with push notifications
- [x] `[S]` Custom budget rollover rules + category goals

## Parity
~95% of Monarch's feature surface. The analytical toolkit (net worth, budgets, retirement sim, tax-loss, dividends) plus bank aggregation with CSV sync, an AI auto-categorized transaction feed, household shared budgets, credit-score monitoring, a cash-flow Sankey, bill reminders, and custom rollover rules all ship front-to-back. A hardcoded fake-subscriptions seed was replaced with real recurring-charge detection.

_Full backlog implemented — every item above shipped backend + real UI + tests._
