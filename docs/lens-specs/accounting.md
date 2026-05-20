# accounting — Feature Completeness Spec

Rival app(s): QuickBooks Online, Xero
Sources:
- https://quickbooks.intuit.com/online/whats-new/
- https://quickbooks.intuit.com/r/product-update/whats-new-quickbooks-online-march-2026/
- https://quickbooks.intuit.com/accounting/contractors/

## Features

### Core ledger (DONE — 62 existing macros)
- [x] Chart of accounts — create/list/update/archive (coa-*)
- [x] Double-entry journal — je-post, ledger-list
- [x] Trial balance, ledger validation (trialBalance, validate-ledger)
- [x] Financial statements — P&L, balance sheet, cash flow (pl-compute, balance-sheet-compute, cashflow-compute)
- [x] Invoices — create/list/mark-paid + Stripe payment link + webhook
- [x] Recurring invoices — create/list/toggle/run-due
- [x] Estimates — create/list/convert-to-invoice
- [x] Bills / accounts payable — bills-create/list/delete/pay
- [x] Vendors + customers — full CRUD
- [x] Expenses — create/list
- [x] Bank feeds (CSV import substitute) — import/list/categorize/bulk-suggest/bulk-accept
- [x] Category rules — create/list/delete
- [x] Reconciliation — reconcile (match suggestions)
- [x] A/R + A/P aging, 1099 summary, audit trail
- [x] Runway forecast, budget variance, dashboard

### Payroll (DONE — this slice)
- [x] Employees — create/list/update/delete (pay rate, type, schedule)
- [x] Pay runs — create a run, compute gross/taxes/deductions/net
- [x] Pay stubs per employee per run
- [x] Payroll journal posting (wages expense, tax liabilities, cash)
- [x] Payroll summary report

### Budgets (DONE — this slice)
- [x] Create a named budget for a fiscal year
- [x] Per-account monthly/annual budget lines
- [x] Budget vs actual report (variance from the journal)

### Products & services / inventory (DONE — this slice)
- [x] Items — service + inventory product types
- [x] Inventory quantity on hand, reorder point
- [x] Stock adjustments; low-stock report
- [x] Invoice/bill line items reference products

### Sales tax (DONE — this slice)
- [x] Sales-tax codes with rates
- [x] Sales-tax liability report (collected vs remitted)
- [x] Record a sales-tax payment

### Purchase orders (DONE — this slice)
- [x] Create POs to vendors with line items
- [x] Receive a PO → convert to a bill

### Financial ratios (DONE — this slice)
- [x] Current ratio, quick ratio, debt-to-equity, gross/net margin, working capital

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live bank feeds | Plaid licensed integration | bank-feeds CSV/manual import + AI categorize + reconcile |
| Real payroll tax filing & deposits | regulated e-file + ACH | payroll computes withholdings + generates the journal; no live filing |
| 1099/W-2 e-filing | IRS FIRE system | summary-1099 + payroll data assemble the figures; export only |
| Multi-currency live FX | FX rate provider | single base currency (USD) |

## Verification log
- 2026-05: backend `node --test tests/accounting-domain-parity.test.js` → 62/62 green (91 macros).
- 2026-05: frontend — 6 new QB-section panels (payroll, budgets, inventory, sales tax,
  purchase orders, ratios) wired into QBShell nav; `npx tsc --noEmit` exit 0.
- 2026-05: `npm run score-lenses` → accounting 7/7 PASS.
- Every spec feature is implemented. Boundary register holds only the 4 genuine
  infrastructure items (live bank feeds, regulated payroll/1099 e-filing, multi-currency).
