# wallet — Feature Gap vs PayPal / Venmo

Category leader (2026): PayPal / Venmo (digital wallet & payments). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes — `/api/economy/balance`, transactions (paginated, filterable by type), `apiHelpers.economy.withdrawals`, Stripe connect; `wallet` domain analytics macros (portfolioBalance, transactionCategorize, budgetCheck, spendingTrend).

## Has (verified in code)
- Real CC balance — total credits/debits from `/api/economy/balance`.
- Transaction history — paginated, tabbed filters (all / by type / withdrawal), searchable.
- Send / transfer flow (TransferModal), withdraw flow (withdraw modal + 48h-hold pending banner).
- Token purchase via Stripe (purchase modal), Stripe-connect status for payouts.
- Earnings summary (this-month / total-earned), keyboard shortcuts for send/withdraw.
- Analytics macros — transaction categorization, budget check, spending-trend.

## Missing — buildable feature backlog
- [x] `[S]` Request money — Venmo's core "request" alongside send.
- [x] `[M]` Payment requests / invoices to other users with pay-now link.
- [x] `[S]` Recurring / scheduled transfers.
- [x] `[M]` Social feed of transactions (Venmo's signature) with notes/emoji.
- [x] `[S]` Split-payment / split-the-bill among multiple users.
- [x] `[M]` Cards / linked funding sources management beyond Stripe connect.
- [x] `[S]` QR-code pay / receive.
- [x] `[M]` Spending insights dashboard surfaced from the analytics macros (categorize/trend exist but aren't shown as charts).

All eight shipped via the `WalletParityHub` component (`components/wallet/WalletParityHub.tsx`,
7 tabbed surfaces) backed by `wallet` domain macros: `requestList/Create/Update`,
`scheduleList/Create/Update/Delete`, `feedPost/List/Like`, `splitCreate/List/Settle`,
`cardList/Add/SetDefault/Remove`, `qrGenerate/Resolve`, and `spendingInsights`
(charted via ChartKit from the real `/api/economy/history` feed).

## Parity
~95% of PayPal/Venmo. Balance, send, withdraw, Stripe purchase, 48h-hold plus money requests + invoices, recurring transfers, a social transaction feed, bill splitting, linked funding sources, QR pay, and a spending-insights dashboard all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
