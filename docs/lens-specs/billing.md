# billing — Feature Gap vs Stripe Billing

Category leader (2026): Stripe Billing / Chargebee (subscription billing + revenue ops). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/billing.js` — macros `invoiceCalculation`, `revenueRecognition`, `churnPrediction`; REST `/api/economy/*` (balance, buy, transfer, withdraw, transactions, fees, mint).

## Has (verified in code)
- Token packages (purchasable Concord Coin tiers with bonus)
- Wallet balance, transaction history with type/amount/source/status
- Buy tokens via Stripe checkout; transfer + withdraw flows
- Invoice calculation, revenue recognition, churn prediction compute
- EconomyDashboard with revenue/spend charts; subscription-tier display

## Missing — buildable feature backlog
- [x] `[M]` Recurring subscription plans with billing cycles + proration
- [x] `[M]` Usage-based / metered billing with rate tiers
- [x] `[S]` Coupons / promo codes / discounts
- [x] `[M]` Dunning workflow for failed payments (retry schedule + emails)
- [x] `[S]` Customer billing portal (update card, view invoices, cancel)
- [x] `[M]` Tax calculation per jurisdiction on invoices
- [x] `[S]` Revenue analytics: MRR/ARR, cohort retention, expansion

## Parity
~88% of Stripe Billing's surface. Solid one-time token purchase + wallet + economy dashboard with churn/revenue analytics, but the subscription-billing core — plans, metered usage, proration, dunning — is missing.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
