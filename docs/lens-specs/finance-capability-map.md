# Finance Lens — Capability Map (Flagship Rebuild)

> Derived, not asserted. Every macro below was enumerated by grepping
> `server/domains/finance.js` (2020 LOC) + inline `registerLensAction("finance", …)`
> in `server/server.js`. Realtime/feature/panel surfaces were read from the actual
> files. Classification follows the Frontend Rebuild Program's
> distinction: **DESIGNED** (bespoke UI wired to the macro's real shape) /
> **GENERIC-STRIP-ONLY** (previously only reachable via an auto-generated button
> array / artifact-transform stub) / **UNSURFACED** (registered, no frontend caller).
>
> Reproduce the macro list:
> `grep -nE "registerLensAction\\(\"finance\"" server/domains/finance.js server/server.js`

## Backend surface

### Registered macros — `server/domains/finance.js` (73)

| Macro | Real result shape (key fields) | Classification |
|---|---|---|
| `dashboard-summary` | `{netWorth, delta, deltaPct, breakdown:{cash,investments,credit,loans}, buyingPower, budgetUsedPct, upcomingBills[], activeGoalCount, accountCount, positionCount}` | **DESIGNED** — header StatTile strip (real zeros when empty) |
| `net-worth-snapshot` | `{snapshot:{date,cash,investments,realEstate,crypto,liabilities,total}}` | **DESIGNED** — "Record snapshot" action (honest macro-dispatch spinner) |
| `net-worth-history` | `{snapshots:[{date,total,…}], range, total, notes}` | **DESIGNED** — real snapshot line chart (replaces the removed synthetic sine chart) |
| `monthly-trend` | `{series:[{month,income,spend,net,savingsRate}], avgMonthlyIncome, avgMonthlySpend, avgNet}` | **DESIGNED** — income/spend/net mini-bars |
| `holdings-list` / `-add` / `-remove` / `-update-price` | `{holdings[], totalValue}` | **DESIGNED** — `HoldingsManager` (Positions group) |
| `accounts-list` / `-link` / `-unlink` / `-update-balance` | `{accounts[], totalAssets, totalLiabilities, netWorth}` | **DESIGNED** — `AccountsPanel` (Accounts group) |
| `accounts-sync-link` / `accounts-sync-pull` | linked-institution + ingested batch | **DESIGNED** — `BankAggregation` |
| `transactions-list` / `-ingest` / `-recategorise` / `-delete` | `{transactions[], count, totalSpend, totalIncome}` | **DESIGNED** — `TransactionFeed` (Cash-flow group) |
| `spending-insights` | `{trends[], anomalies[], topGrowth[], topShrink[]}` | **DESIGNED** — `SpendingInsights` |
| `cashflow-sankey` / `cashflow-forecast` | Income→Net→category flows / forecast | **DESIGNED** — `CashFlowSankey` |
| `investment-checkup` | `{allocation[], drift, concentrationRisk, fees[], score}` | **DESIGNED** — `InvestmentCheckup` (real; errors honestly with no holdings) |
| `dividends-summary` / `dividends-calendar` / `earnings-calendar` | dividend + earnings calendars | **DESIGNED** — `DividendTracker` |
| `tax-estimate` | IRS-2026-bracket estimate | **DESIGNED** — `TaxEstimator` (Planning group) |
| `tax-loss-candidates` | harvest candidates | **DESIGNED** — `TaxLossHarvester` |
| `retirement-monte-carlo` | MC projection | **DESIGNED** — `RetirementSimulator` |
| `goals-list` / `-create` / `-contribute` / `-delete` | savings goals | **DESIGNED** — `GoalsTracker` |
| `bills-list` / `-add` / `-pay` / `-delete` | bills | **DESIGNED** — `BillsCalendar` |
| `bill-reminders` / `bill-reminder-snooze` | reminders | **DESIGNED** — `BillReminders` |
| `recurring-list` / `-create` / `-pause` / `-cancel` | recurring investments | **DESIGNED** — `RecurringInvestments` |
| `subscriptions-detect` / `subscriptions-cancel` | detected subs | **DESIGNED** — `SubscriptionDetector` |
| `envelopes-list` / `-create` / `-delete` / `monthly-income-set` | envelope budget | **DESIGNED** — `EnvelopeBudget` |
| `rollover-rules-list` / `rollover-rule-set` / `-delete` / `rollover-apply` | rollover rules | **DESIGNED** — `RolloverRules` |
| `household-get` / `-create` / `-add-member` / `-remove-member` / `-budget-create` / `-budget-spend` | shared budgets | **DESIGNED** — `HouseholdBudgets` |
| `credit-score-record` / `-delete` / `credit-score-report` | `{history[], latest, band, advice[]}` | **DESIGNED** — `CreditScoreMonitor` |
| `rules-list` / `-create` / `-delete` / `-apply` / `categorize-transaction` | categorisation rules | **DESIGNED** — `CategorisationRules` |
| `assistant-ask` | `{answer, source}` (conscious brain; honest offline fallback) | **DESIGNED** — `FinanceAssistant` |
| `weekly-commentary` | LLM commentary | GENERIC-STRIP-ONLY — surfaced inside `FinanceAssistant`/action panel |
| `feed` | live FX feed | **DESIGNED** — `LensFeedPanel` / `LensFeedButton` |

### Inline macros — `server/server.js` (5)

| Macro | Reality | Classification |
|---|---|---|
| `finance.trade` | artifact-transform stub (no real order book / market to fill against) | **GENERIC-STRIP-ONLY (retired from UI)** |
| `finance.analyze` | artifact-transform stub | GENERIC-STRIP-ONLY (retired) |
| `finance.alert` | artifact-transform stub | GENERIC-STRIP-ONLY (retired) |
| `finance.simulate` | artifact-transform stub | GENERIC-STRIP-ONLY (retired) |
| `finance.generate_report` | artifact-transform stub | GENERIC-STRIP-ONLY (retired) |

### Artifact-transform macros — top of `finance.js` (4)

`portfolioAnalysis`, `budgetTracker`, `compoundInterest`, `debtPayoff` operate on a
seeded DTU **artifact** (`runFinanceAction({id, action})`), not on the user's real
portfolio state. They are **GENERIC-STRIP-ONLY** and were previously surfaced as a raw
4-button strip that is dead unless a `finance/asset` DTU artifact happens to exist. The
real portfolio-analysis surface is `investment-checkup` (reads real `holdings`). These
four are **not** promoted to primary; `investment-checkup` supersedes them by design.

### Realtime + external-data surfaces (all real, kept)

- `useRealtimeLens('finance')` → **live Yahoo Finance indices** (`^GSPC`, `^DJI`,
  `^IXIC`, `^RUT`, `^VIX`) — real quotes. Surfaced as the terminal **Market Monitor**
  DataTable + a live `StatusDot`. Honest "market feed offline" state when `!isLive`.
- `FredSeriesPanel` → **real FRED economic series** (FRED_API_KEY-gated, honest
  no-key/empty states). Macro-data group.
- `WorldBankPanel` → **real World Bank country indicators**. Macro-data group.
- `MarketsPulse` → **real CoinGecko global/markets** (live fetch). Macro-data group.
- `LensFeedPanel` / `LensFeedButton` → real live FX rate web feed.

### Cross-mountable panel — `concord-frontend/lib/panel-registry.ts`

- `finance.accounts` → `AccountsPanel` (already registered; also mounted here in-lens).

## What the rebuild changed (honest-by-construction)

**Removed fabricated data** (the honesty violations in the old 2506-line page):
1. **Synthetic portfolio chart** — the old chart generated 100 points from layered
   `Math.sin`/`Math.cos` seeded off `totalValue` and labeled it "Portfolio Performance
   over time." Replaced with a **real `net-worth-history` line chart** (honest empty
   state when the user has logged no snapshots).
2. **Fabricated 24h High/Low** — `price * 1.05` / `price * 0.95` presented as real
   session extremes. Removed with the trade panel.
3. **Fake order-book depth** — bid/ask depth bars used `((i+1)/8)*100` when no fill
   existed. Removed (`finance` has no order-book/limit-order backend — that lives in
   the separate `markets` prediction-market domain).
4. **Facade trade / orders / alerts surfaces** — stored generic DTU artifacts as if
   they were live market orders/alerts against a market that cannot fill them. Removed.

**Retired generic scaffold:** `AutoActionStrip`, `ShellPreview`, the raw 4-button
"Finance Analysis" strip, `UniversalActions` button strip, `RecentMineCard`,
`CrossLensRecentsPanel` — replaced with a designed, keyboard-navigable terminal
workspace grouped by real workflow (Overview / Positions / Cash-flow / Accounts /
Planning / Bills & Budget / Macro data / Assistant).

**Coverage metric (DESIGNED only):** every non-stub finance macro is now surfaced by a
deliberate design decision (dashboard header, real net-worth chart, or a grouped
bespoke panel), never by an auto-generated button wall. The 9 stub/artifact-transform
macros are intentionally *not* promoted; `investment-checkup` supersedes them.
