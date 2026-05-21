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
- [ ] `[L]` Bank aggregation via Plaid/MX — accounts are manual; leaders auto-sync transactions
- [ ] `[M]` Automatic transaction feed + AI auto-categorization at ingest
- [ ] `[S]` Joint / household shared budgets with multiple members
- [ ] `[M]` Credit score monitoring + report integration
- [ ] `[S]` Cash-flow Sankey / month-over-month trend charts
- [ ] `[M]` Bill-pay + payment reminders with push notifications
- [ ] `[S]` Custom budget rollover rules + category goals

## Parity
~70% of Monarch's feature surface. The analytical toolkit (net worth, budgets, retirement sim, tax-loss, dividends) is unusually deep, but without live bank aggregation the data-entry burden is on the user — the single biggest gap vs Monarch/Empower.
