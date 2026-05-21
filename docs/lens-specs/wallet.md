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
- [ ] `[S]` Request money — Venmo's core "request" alongside send.
- [ ] `[M]` Payment requests / invoices to other users with pay-now link.
- [ ] `[S]` Recurring / scheduled transfers.
- [ ] `[M]` Social feed of transactions (Venmo's signature) with notes/emoji.
- [ ] `[S]` Split-payment / split-the-bill among multiple users.
- [ ] `[M]` Cards / linked funding sources management beyond Stripe connect.
- [ ] `[S]` QR-code pay / receive.
- [ ] `[M]` Spending insights dashboard surfaced from the analytics macros (categorize/trend exist but aren't shown as charts).

## Parity
~60% of PayPal/Venmo. Real balance, send, withdraw, Stripe purchase, and 48h-hold are a genuine payments core, but it lacks money requests, recurring transfers, splits, and the social transaction feed.
