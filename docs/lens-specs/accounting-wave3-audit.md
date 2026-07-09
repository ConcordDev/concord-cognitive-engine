# accounting — Wave 3 audit (fixes shipped)

Frontend Rebuild Program, Wave 3. `accounting` already scored `polished`
under `grade-ux-polish.mjs --honest` (`isGenericScaffold: false`). This audit
reads the actual code (not the grader) to check which of the macros the
triage script flagged as "unsurfaced" are real gaps vs. false positives, then
fixes the confirmed real gaps.

Backend: `server/domains/accounting.js` (~4,052 LOC, ~116 macros). Frontend:
`concord-frontend/app/lenses/accounting/page.tsx` + 24 components under
`concord-frontend/components/accounting/`.

## `node scripts/lens-unsurfaced.mjs --lens accounting`

```
accounting: 13/116 macros never referenced in the frontend

  ai-* (2): ai-categorize-txn, ai-suggest-vendor
  generate-* (2): generate-invoice, generate-statements
  bank-* (1): bank-feeds-uncategorize
  coa-* (1): coa-update
  customers-* (1): customers-update
  employee-* (1): employee-update
  invoice-* (1): invoice-webhook-mark-paid
  item-* (1): item-update
  je-* (1): je-tag-dimension
  payroll-* (1): payroll-summary
  vendors-* (1): vendors-update
```

## Classification

### (a) Real gap — fixed this pass

**`coa-update` / `customers-update` / `vendors-update` / `employee-update` / `item-update`** — the same
pattern repeated across five entity panels: `ChartOfAccountsTab` (in
`AccountingWorkbench.tsx`), `CustomersPanel.tsx`, `VendorsPanel.tsx`,
`AcPayrollPanel.tsx` (employees), and `AcInventoryPanel.tsx` (items) all had
Create + List + Delete/Archive wired, but no way to *edit* an existing
record short of deleting and recreating it (which would orphan any
references — journal-entry `accountId`, bill/invoice `vendorId`/`customerId`,
pay-stub `employeeId`, line-item `itemId`). Fixed: added an inline
edit-in-place affordance (pencil icon → editable row → Save/Cancel) to each
panel, wired to the matching `*-update` macro. `coa-update` also now backs a
rename in the Chart of Accounts.

**`payroll-summary`** — computes YTD gross/net/withholding + active employee
count, but `AcPayrollPanel.tsx` never called it — there was no YTD summary
anywhere in the payroll tab (only per-run totals). Fixed: added a 4-tile
summary strip (active employees, all-time runs, YTD gross, YTD withholding)
at the top of the panel.

**`je-tag-dimension`** — the "Dimensions" tab in `AdvancedAccountingPanel.tsx`
lets a user create class/location/project tags and run `segment-pl`, but nothing
in the UI ever called `je-tag-dimension` to actually tag a posted journal
entry with one — so `segment-pl` would always return zero-population
segments. This wasn't a cosmetic gap; it silently made the entire Dimensions
feature non-functional (its own empty-state text — "Tag journal entries to
enable segment P&L" — describes an action nothing in the UI could perform).
Fixed: (1) `ledger-list` backend now includes each entry's `dimensions` array
in its row shape (previously omitted); (2) `LedgerTab` in
`AccountingWorkbench.tsx` renders each entry's tags as pills and offers a
"tag" picker (populated from `dimension-list`) that calls `je-tag-dimension`.

**`bank-feeds-uncategorize`** — `BankFeedsInbox.tsx` only ever listed
`status: 'uncategorized'` transactions; `bank-feeds-list` already supports
`status: 'categorized'`/`'all'`, confirming a "categorized" view was the
intended design, but nothing rendered it and there was no way to undo a
mis-categorization short of manually posting a correcting journal entry
(not a discoverable path for a non-accountant user). Fixed: added a
"Categorized" tab alongside "Inbox" showing categorized transactions with
an Undo button per row that calls `bank-feeds-uncategorize` (reverses the
categorization and deletes the auto-posted JE, then returns the txn to the
inbox).

### (b) False positive / superseded — no change

**`ai-categorize-txn`** — single-transaction AI category suggestion.
Superseded in practice: `BankFeedsInbox.tsx`'s "Suggest all" button calls
`bank-feeds-bulk-suggest`, which runs the exact same `suggestCategoryForTxn`
core over every uncategorized transaction (including a lone one) and renders
a per-row account picker + confidence badge + Accept button — functionally
equivalent coverage, already live. No parallel single-txn button needed.

**`generate-invoice`** — computes invoice totals from raw line items into a
transient `artifact.data.lastGeneratedInvoice` scratch field (never
persisted). Superseded: `app/lenses/accounting/page.tsx`'s "Invoicing" mode
already has a complete, better invoice-creation flow — its own client-side
subtotal/tax/total computation (identical math: `qty*unitPrice`,
`subtotal*taxRate`) plus real persistence via `invoiceData.create` (a DTU).
Building a second, macro-backed invoice-creation UI alongside the shipped
one would be a confusing duplicate path, not a fix.

**`generate-statements`** — bundles trial-balance + P&L + cash-flow into one
call over a caller-supplied `artifact.data.accounts` array (a different,
older "artifact-scoped" ledger representation, distinct from the live
`coa`/`journal` state the rest of the domain uses — see `invoice-webhook-mark-paid`
note below for the pattern this belongs to). The three constituent reports
already exist as separately-wired live-state UI: `trialBalance` (wired via
`handleAction('trialBalance', ...)` in `page.tsx`), `PLStatement.tsx` (calls
`pl-compute`), `CashFlowStatement.tsx` (calls `cashflow-compute`), and
`AccountingWorkbench.tsx`'s `BalanceSheetTab` (`balance-sheet-compute`).
Same informational surface, already shipped, just not bundled into one call.

**`invoice-webhook-mark-paid`** — the handler's own doc comment says it plainly:
"INTERNAL macro called by the Stripe webhook." Confirmed backend-only by
design (server-to-server callback target, not a user-facing action).

**`ai-suggest-vendor`** — matches a vendor from a free-text bank-transaction
description, or suggests a name for a new vendor. Real capability, but no
natural landing spot in the current schema: `bankTxn` records have no
`vendorId` field at all (bank-feeds categorization only links a txn to a
chart-of-accounts `accountId`, never to a vendor), so wiring this in would
mean either inventing a shallow, disconnected "vendor hint" chip with no
persistence, or first extending the bank-feeds schema to carry a vendor
reference — a real, separate design decision, not a same-pass UI bolt-on.
Deferred rather than built shallow; noted here so it isn't silently dropped.

## Verify

- `cd concord-frontend && npx eslint components/accounting/AccountingWorkbench.tsx components/accounting/CustomersPanel.tsx components/accounting/VendorsPanel.tsx components/accounting/AcPayrollPanel.tsx components/accounting/AcInventoryPanel.tsx components/accounting/BankFeedsInbox.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `accounting` still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `accounting` still `tier: "polished"`, `isGenericScaffold: false`.
