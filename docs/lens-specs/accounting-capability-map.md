# accounting — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("accounting"' server/domains/accounting.js` → 116

## Reference app + parity target

**QuickBooks Online / Xero-class** SMB books: chart of accounts, journal,
A/R (invoices, estimates, recurring invoicing, Stripe payment links),
A/P (bills, vendors, recurring bills, purchase orders), payroll
(employees, pay runs, ACH batch, tax e-file), banking (AI transaction
categorization), budgets, inventory, sales tax, 1099/W-2 e-file, multi-
currency + FX revaluation, class/dimension tagging, financial ratios. The
backend (`server/domains/accounting.js`, 4,053 LOC / 116 macros, all
`registerLensAction`) is a genuinely deep, server-authoritative
double-entry engine — per-user persistent chart of accounts + journal
(`STATE.accountingLens`), balance-enforced journal posting, real Stripe
invoice payment links, real bank-feed AI categorization with rule +
heuristic + brain fallback. This was NOT a thin lens; the defect found here
was architectural, not depth.

## Findings

### Defect 1 — a disconnected, non-functional "books" sandwiched under the real books (fixed, major surgery)

`app/lenses/accounting/page.tsx` was 3,109 lines. The top ~190 lines
mounted the real system (`BooksSection`, a QuickBooks-style sidebar shell
covering dashboard/banking/invoices/bills/customers/vendors/reports —
already wired to the persistent CoA/journal). Below it, an entirely
separate ~2,900-line page rendered: its own header ("Accounting &
Finance"), a Library/Dashboard toggle, 7 generic-artifact CRUD types
(`Account`/`Transaction`/`Invoice`/`PayrollEntry`/`Budget`/`Property`/
`TaxItem` via `useLensData('accounting', type)` — the platform's
domain-agnostic `/api/lens/:domain` artifact store, unrelated to
`STATE.accountingLens`), a full editor modal, and dedicated report
renderers (Trial Balance, P&L, Balance Sheet, Cash Flow, Reconciliation,
Invoice Aging, Payroll Calculator, Budget Variance) — a second, complete
bookkeeping UI with **no relationship to the real ledger**.

This is the "fabricated parallel generic-CRUD system sitting beside a real
component" defect class, and it was actively **dishonest at runtime**, not
just redundant: the "Server-Computed Trial Balance" button called the real
`trialBalance` macro (`useRunArtifact('accounting').mutateAsync({ id:
accountData.items[0]?.id, action: 'trialBalance' })`), but that macro reads
`artifact.data.accounts` — an array of `{accountNumber, name, type,
entries}` — while the artifact it actually ran against was a single
generic `Account` record shaped `{name, accountNumber, type, balance,
currency, institution}` (no `.accounts` sub-array, no `.entries` at all).
Every run therefore returned `{ accounts: [], totalDebits: 0,
totalCredits: 0, difference: 0, isBalanced: true }` — an empty table under
a green "Books are balanced" banner, unconditionally, regardless of what
the user had entered. Same root cause for `profitLoss` (bar chart with
`$0`/`$0`), `invoiceAging`, `budgetVariance`, and `rentRoll` (Property
mode — `artifact.data.properties` never existed on a singular `Property`
artifact). This is the exact "phantom-success" pattern named in
`CLAUDE.md`'s zero-demo-content section: a labeled, confidently-rendered
result that is silently vacuous by construction.

The dashboard's KPI strip made it worse with a second, independent
fabrication: `{ id: 'revenue', ..., deltaPct: 12.5, caption: 'vs prior
period' }` — a **hardcoded** `+12.5%`/`-3.2%`/`+18.4%` delta on every
load, not computed from anything.

**Fix:** removed the entire legacy generic-CRUD system. `page.tsx` is now
~190 lines: `BooksSection` (primary, now **controlled** — `nav`/
`onNavChange` lifted to the page so real keyboard shortcuts can drive it)
+ `AccountingWorkbench` (companion drawer, unchanged, already real) +
`AccountingActionPanel` + `CategoryRulesPanel` (real, unchanged mount) +
World Bank macro-context chart + `RealtimeDataPanel`/`DTUExportButton` +
a collapsed-by-default `LensFeaturePanel` reference. `StripeInvoicePanel`
(392 LOC, real Stripe-backed invoice CRUD — was previously only reachable
through the now-deleted legacy Invoicing▸Stripe sub-tab) was given a
proper home: `BooksSection`'s `invoices` nav item now mounts it directly
instead of an "open the workbench" placeholder hint.

Also removed: `<UniversalActions>` (would have been permanently disabled
— it requires a selected generic-artifact id, and there is no longer a
generic-artifact list to select from on this page) and `<AutoActionStrip>`
("More actions" — an auto-generated wall of all 116 raw macro buttons with
a JSON-paste param box; every one of those macros already has a real,
designed panel in `BooksSection`/`AccountingWorkbench`, so the strip was
pure duplicate clutter of exactly the generic-scaffold shape the
zero-generic-tendencies invariant names). `MobileTabBar` was removed since
it drove the now-deleted `ModeTab` state; ~~re-adding a real mobile
affordance for `BooksShell`'s sidebar nav is a legitimate small follow-up
(ENGINEERING, not attempted here to keep this pass to the verified defect).~~
**Follow-up done (2026-07-12, `3e49176f`, Wave 4)** — `BooksShell` now
hides the sidebar below `md` and offers a mobile header row (active
destination + hamburger) opening the same grouped nav as a slide-over
drawer; select navigates + closes, close/backdrop dismiss without
navigating. Pinned by `tests/components/BooksShellMobileNav.test.tsx` (4/4).

### Defect 2 — `AccountingActionPanel` field-shape mismatches (fixed)

`AccountingActionPanel.tsx` (249 LOC, a real bespoke "paste your books
JSON, get a computed report" power-user bench — distinct from the
sandbox above; it correctly uses the dispatch-layer's
`peelRedundantArtifactWrapper` unwrap, `{ artifact: { data: parsed } }` →
`parsed`, so the *input* plumbing was sound) still had three broken
report types from placeholder text and result-shape assumptions that never
matched the real macros:

- **Trial balance / P&L** — placeholders told users to paste
  `{"entries":[...]}` / `{"transactions":[...]}`; both macros read
  `artifact.data.accounts` (an array of accounts, each carrying its own
  `entries`). Wrong top-level key → always `[]`.
- **Budget variance** — placeholder said `{"lines":[...]}`; the macro
  reads `artifact.data.budget`. Wrong key → always empty. The result
  render then called `varResult.lines.slice(0, 4)` and `varResult.status`
  — neither exists on the real `budgetVariance` output (`lineItems`, no
  top-level `status`) — an actual `TypeError` on any non-empty result had
  the input side ever worked.
- **P&L result read** — `plResult.revenue.toLocaleString()` treated the
  real `{ lines, total }` object as a number (`Object.prototype
  .toLocaleString()` silently prints `"[object Object]"`, no crash, wrong
  number); `plResult.grossMargin`/`.expenses`/`.period` (string) don't
  exist (real: `grossMarginPct`, `operatingExpenses.total`, `period:
  {start,end}`).
- **Trial balance result read** — `tbResult.balanced`/`.accountCount`
  don't exist (real: `isBalanced`, `accounts.length`).

`invoiceAging` was already correct on both ends (input `data.invoices`,
result shape matches the component's `AgingResult` interface exactly) —
left unchanged.

**Fix:** corrected all four input placeholders to the real
`artifact.data` shapes, corrected the `TbResult`/`PlResult`/`VarResult`
TypeScript interfaces to the real macro output shapes, and fixed every
read site (result cards, the DM digest, the CFO-brief agent prompt, the
DTU-mint/publish titles) to the real field names. `docs/UI_QUALITY_RUBRIC`
motivation aside, this turns four previously-decorative buttons into
correct ones.

## Macro coverage (DESIGNED vs UNSURFACED)

`node scripts/lens-unsurfaced.mjs --lens accounting` reports 6/116 using
its whole-frontend token grep (permissive — undercounts). A domain-scoped
grep (only `components/accounting/*.tsx` + the accounting page) finds 8;
the extra 2 (`audit-trail`, `reconcile`) match elsewhere in the frontend
for unrelated lenses, which is exactly the tool's documented
under-reporting direction.

**DESIGNED (108/116)** — every one of these has a real, bespoke, non-generic
UI surface (not a button-wall entry): chart of accounts + journal posting
+ ledger + balance sheet + AR aging (`AccountingWorkbench` — 1,020 LOC,
6 tabs) · dimensions/currency/FX/bank-institution-linking/e-file/payroll-
ACH/receipt-OCR/recurring-bills/segment-P&L/audit-log/vendors
(`AdvancedAccountingPanel` — 922 LOC, the Workbench's "Advanced" tab) ·
dashboard KPIs (`AccountingDashboard`) · bank-feed AI bulk-categorize
(`BankFeedsInbox`) · customers/vendors/bills/expenses/estimates/recurring-
invoices (`CustomersPanel`/`VendorsPanel`/`BillsPanel`/`ExpensesPanel`/
`EstimatesPanel`/`RecurringInvoicesPanel`) · P&L/cash-flow/runway/AP-aging/
1099/payroll/budgets/inventory/sales-tax/purchase-orders/ratios (one
dedicated panel each) · Stripe invoicing (`StripeInvoicePanel`) · the
paste-JSON CFO bench for TB/P&L/aging/variance (`AccountingActionPanel`,
now field-shape-correct) · bank-feed category rules (`CategoryRulesPanel`).

**GENERIC-STRIP-ONLY (0/116)** — none; the two generic-wall components that
used to reach these macros (`UniversalActions`, `AutoActionStrip`) were
removed in Defect 1's fix specifically because everything they could reach
already had a designed panel.

**UNSURFACED (8/116)**, each judged:
- `ai-categorize-txn` — intentional. `BankFeedsInbox`'s "Suggest all"
  button calls the batch macro `bank-feeds-bulk-suggest`, which internally
  loops the same `suggestCategoryForTxn` helper this single-txn macro
  wraps. A per-row "suggest this one" button would be a redundant,
  lower-value duplicate of the existing one-click bulk flow.
- ~~`ai-suggest-vendor` — **real gap, ENGINEERING**. `BillsPanel`'s vendor
  field is a plain dropdown of existing vendors only; there's no free-text
  vendor auto-match/creation-suggestion flow the macro would back. Small,
  contained addition — not attempted here to keep this pass scoped to the
  verified defects above.~~ **CLOSED (2026-07-12, `975ceca9`).** `BillsPanel`'s
  vendor field on the New-bill form is now a free-text combobox: typing
  debounces (350ms) a real call to `ai-suggest-vendor`, and the dropdown
  shows the macro's own token-overlap match (with its real `score`, never
  invented client-side) or — when nothing matches well — the macro's
  suggested new-vendor name behind a "Create vendor" action that calls the
  real `vendors-create` macro. The field is never force-locked to only
  known/suggested vendors — any free text can still be typed and, once a
  vendor is selected (existing, AI-matched, or freshly created), submitted
  with the bill. See `concord-frontend/components/accounting/BillsPanel.tsx`
  + `concord-frontend/tests/components/BillsPanel.test.tsx`.
- `audit-trail`, `generate-invoice`, `generate-statements`, `reconcile` —
  the four remaining legacy artifact-shaped macros from the deleted
  sandbox (Defect 1). Each is fully superseded by a real 2026-parity
  equivalent (`audit-log-list`, `invoice-create` + `StripeInvoicePanel`,
  `pl-compute`/`balance-sheet-compute`/`cashflow-compute`, the bank-feed
  categorize/bulk-suggest/bulk-accept flow respectively). Left registered
  and harmless — not deleted server-side (out of scope: this pass is
  frontend-only per the unit assignment), just no longer reachable from a
  UI that would have run them against the wrong data shape anyway.
- `invoice-webhook-mark-paid` — correctly webhook-only (Stripe payment
  webhook calls it server-to-server); no UI surface should exist.
- ~~`validate-ledger` — legacy artifact-shaped ledger-integrity checker.
  Lower priority than it looks: the persistent journal structurally can't
  go out of balance (`je-post` rejects any entry where debits ≠ credits
  before it's ever written), so the macro's value is narrower now (mainly
  useful for validating externally-pasted/imported books via
  `AccountingActionPanel`). A `Validate ledger` 5th button there would be
  a reasonable small ENGINEERING follow-up.~~ **CLOSED (2026-07-12,
  `975ceca9`).** `AccountingActionPanel` now has a 5th "Validate" action
  next to TB/P&L/AR-aging/variance, wired to the real `validate-ledger`
  macro against the same pasted books JSON as the TB field. It renders the
  macro's actual result — balanced/out-of-balance state, total debits vs.
  credits, and any per-account issues the macro found — with an honest "no
  issues" state (no fabricated warnings) when `accountIssues` comes back
  empty, never a raw JSON dump. See
  `concord-frontend/components/accounting/AccountingActionPanel.tsx` +
  `concord-frontend/tests/components/AccountingActionPanel.test.tsx`.

**Genuinely missing (deferred), triaged:** multi-unit property / rent-roll
management (the legacy sandbox's `rentRoll` + "Properties" tab were never
functional — the `Property` artifact never had the `.properties[]`/
`.units[]` array shape the macro reads, so this was decorative before
Defect 1's fix too, not a real regression). Property/rent-roll management
is arguably out of scope for a general-ledger accounting lens by design —
that's the `realestate`/property-management vertical's job, not
QuickBooks/Xero's (neither ships tenant/unit tracking) — **non-goal**, not
a disposition-needed gap.

## Verification

- `npx eslint app/lenses/accounting/page.tsx components/accounting/BooksSection.tsx components/accounting/AccountingActionPanel.tsx tests/accounting-lens-states.test.tsx` — clean, 0 errors/warnings.
- `npx tsc --noEmit` — **not run** (standing rule for this pass: prior parallel batch OOM'd the container). Manual type review done for every touched file (see diff); no `any`-laundering introduced, all interfaces match the real macro outputs read directly from `server/domains/accounting.js`.
- `npx vitest run tests/accounting-lens-states.test.tsx` — 5/5 passing (rewritten to pin the real architecture: controlled `BooksSection` nav, real wallet-balance channel, real keyboard-command → state-change wiring — the old test asserted the now-removed generic-CRUD loading/error/empty/populated states and would have been testing a deleted system).
- `node --test tests/accounting-domain-parity.test.js tests/accounting-lens-macros.test.js` (server, unaffected — no backend files touched) — 123/123 passing.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — accounting: `tier: "polished"`, `isGenericScaffold: false`, `pageLoc: 190`, `maxBespokeComponentLoc: 1021`, `bespokeRatio: 0.968` (up from a page that was 94% legacy-sandbox LOC).
