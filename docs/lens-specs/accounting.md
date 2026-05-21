# accounting — Feature Gap vs QuickBooks Online

Category leader (2026): QuickBooks Online. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/accounting.js` — 91 registered macros (full CoA, je-post, trial balance, P&L/balance-sheet/cashflow, invoices + Stripe payment links + webhooks, recurring invoices, estimates→invoice, bills/AP, customers/vendors CRUD, bank-feeds import + AI categorize + category rules + reconcile, payroll runs/stubs, budgets vs actual, inventory items + stock, sales-tax codes/liability, purchase orders, financial ratios, 1099 summary).

## Has (verified in code)
- Six modes (Ledger, Invoicing, Payroll, Budget, Properties, Tax) with keyboard nav
- Chart of Accounts tree; double-entry journal builder with live balance check + post
- Server-computed trial balance, P&L, cash flow, balance sheet, ledger validation
- Invoice builder (line items, tax, terms), AR/AP aging; Stripe payment links + webhook mark-paid
- Bank-feed CSV import with AI transaction categorization + category rules + reconciliation
- Payroll calculator + pay runs + stubs + payroll journal; budgets vs actual
- Inventory items with stock adjustments + low-stock; sales-tax codes + liability report
- Purchase orders (receive → bill); financial ratios; runway forecast; 1099 summary

## Missing — buildable feature backlog
- [ ] `[M]` Live bank feed via Plaid-style aggregator (today is CSV/manual import only)
- [ ] `[M]` Multi-currency with FX revaluation (single base USD currently)
- [ ] `[M]` Class/location/project dimensional tagging for segment P&L
- [ ] `[L]` Payroll tax e-filing + ACH deposits (computes withholdings but no filing)
- [ ] `[S]` Recurring bill/expense scheduling (only invoices recur)
- [ ] `[M]` Mobile receipt-capture OCR → expense
- [ ] `[S]` Per-transaction edit audit log (who/when/what)
- [ ] `[M]` 1099/W-2 e-filing export to IRS FIRE format

## Parity
~78% of QuickBooks Online's feature surface. Unusually deep — full double-entry, payroll, inventory, sales tax, and POs all real. Remaining gaps are licensed integrations (live bank feeds, e-filing) and multi-currency/dimensional reporting.
