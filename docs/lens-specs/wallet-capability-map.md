# Wallet Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("wallet"' server/domains/wallet.js
```
→ **24** macros in `server/domains/wallet.js` (891 lines). No inline
`register("wallet", ...)` in `server.js` (`grep -c 'register("wallet"'
server/server.js` → 0).

```
node scripts/lens-unsurfaced.mjs --lens wallet
```
→ `wallet: 0/24 macros never referenced in the frontend` — every macro is
called from somewhere in the frontend. (The scanner is a coverage check, not
a quality check — see the classification below for whether each reach is a
*designed* feature or a generic pass-through.)

**Two separate money surfaces, both real.** The wallet lens is the front end
for two independent backends that must not be conflated:
1. **`server/domains/wallet.js`** (24 macros) — the Venmo/PayPal-parity
   peer-to-peer layer: money requests/invoices, recurring transfers, a
   social transaction feed, split-the-bill, linked funding sources, QR
   pay/receive, and a spending-insights/budget/categorize/portfolio toolkit.
   State-backed via `globalThis._concordSTATE.walletLens` (in-memory Maps,
   persisted through the platform's general STATE-save debounce — the same
   pattern other lens domains use for non-SQL-table state).
2. **`server/economy/*`** (`balances.js`, `withdrawals.js`, `fees.js`,
   `ledger.js`) + the `/api/economy/*` HTTP routes in `server.js` — the core
   CC ledger: balance, buy (Stripe Checkout), transfer, withdraw (Stripe
   Connect payout), transaction history. This is the constitutional-invariant
   surface (`CREDIT_ROW_PREDICATE`, `WITHDRAWABLE_EARNED_TYPES`, the 48-hour
   hold, the hardcoded fee schedule) — **not touched by this pass**, only
   read for verification.

## The defect: two real UI-level bugs, both financial-transparency issues, no fabricated data anywhere

Unlike several other lenses in this program, wallet's defect class here is
**not** "fake data standing in for a real backend" — every number rendered
on the page traces to a real macro call or a real `/api/economy/*` read.
The two defects found are narrower but still real:

### 1. `WithdrawFlow.tsx` displayed the wrong withdrawal fee (5% vs. the real 1.46%)

`WithdrawFlow.tsx` (the modal opened by the page's "Withdraw" button / `W`
shortcut) hardcoded `PLATFORM_FEE_PERCENT = 5` and rounded the fee **up to
the nearest whole CC** via `Math.ceil()`. The actual backend fee — computed
by `calculateFee("WITHDRAWAL", amount)` in `server/economy/fees.js:7`
(`FEES.WITHDRAWAL = 0.0146`) and applied for real in
`server/economy/withdrawals.js#requestWithdrawal` / the
`POST /api/economy/withdraw` handler in `server.js` — is **1.46%**, rounded
to the nearest cent (`Math.round(amount * rate * 100) / 100`). This is the
same constitutional 1.46% universal rate documented in CLAUDE.md's
"Marketplace fees are hardcoded" section (`TOKEN_PURCHASE_FEE: 0.0146`) and
already correctly used elsewhere on the same page: `TransferFlow` (inline in
`page.tsx`, `TRANSFER_FEE_RATE = 0.0146`) and the sibling
`StripeConnectPanel.tsx` (`PLATFORM_FEE_PERCENT = 1.46`) both had it right.
Only `WithdrawFlow.tsx` — the primary, most-used withdrawal path (the
Withdraw button on the main balance card and the `W` keyboard shortcut both
open it) — showed a fee more than 3× the real one. A user requesting to
withdraw 100 CC saw a preview promising "$95.00" when the real payout is
$98.54; the eventual real withdrawal (computed server-side, correctly, from
`fees.js`) would not match what the confirmation screen told them to expect.
This is exactly the kind of trust-breaking mismatch the constitutional
withdrawal invariants exist to prevent — the *money* was never wrong (the
server always computed the correct 1.46%), but the *preview UI* was lying
to the user about what they'd receive before they confirmed.

A second, smaller instance of the same class: because the fee was
ceil'd to a whole CC, `netPayout` was always an integer, so the JSX
appended a literal `.00` suffix (`` `${netPayout.toLocaleString()}.00` ``,
four call sites). Once the fee is corrected to the real cent-precise 1.46%,
`netPayout` can carry cents (e.g. 98.54) — the literal `.00` suffix would
have rendered `$98.54.00`. Fixed alongside the percentage fix.

**Fixed:** `PLATFORM_FEE_PERCENT` corrected to `1.46` with a comment pointing
at `server/economy/fees.js` as the source of truth; fee/net calculation
changed from `Math.ceil()`-to-whole-CC to
`Math.round(x * 100) / 100`-to-the-cent, matching `calculateFee`'s exact
rounding; all four `${netPayout...}.00` display sites changed to
`.toFixed(2)`. **No change to any fee constant, withdrawal endpoint, or
economy library file** — this is a client-side display correction only, the
real fee computation in `server/economy/fees.js` was never touched.

### 2. A duplicate, permanently-dead "Wallet Actions" panel + a permanently-disabled generic AI action bar

`app/lenses/wallet/page.tsx` mounted two things that could never function,
both instances of the pattern CLAUDE.md names explicitly ("a real macro
reached only through an auto-generated button wall... is still a process
failure"):

- **`<UniversalActions domain="wallet" artifactId={null} compact />`** — the
  generic analyze/generate/suggest AI action bar. `artifactId` was hardcoded
  to `null` (there is no "wallet artifact" concept — wallet's real UI surface
  is macros and ledger reads, not artifacts), and `UniversalActions`
  disables every button when `!artifactId` (`components/lens/
  UniversalActions.tsx:172,209`), showing "Select an artifact first" forever.
  It rendered a permanently-inert row on every page load.
- **The bottom-of-page "Wallet Actions" panel** — four buttons
  (Portfolio Balance / Categorize Txns / Budget Check / Spending Trend)
  wired through `useLensData('wallet', 'account')` +
  `useRunArtifact('wallet')`. `useRunArtifact` POSTs to
  `/api/lens/wallet/:id/run`, which requires a *persisted* artifact id
  (`walletItems[0]?.id`). No code anywhere creates a `type: 'account'`
  artifact for the wallet domain (`useLensData`'s auto-seed only fires in
  dev mode and only when a `seed` array is passed — this call passed none),
  so `walletItems` was always `[]` and every button was permanently
  `disabled={!walletItems[0]?.id || ...}` — dead on every load, for every
  user, forever. This is the exact "dead button gated on a permanently-empty
  generic store" defect class from the assignment brief, and it duplicated
  functionality that was **already correctly built**: `WalletActionPanel.tsx`
  (mounted separately, below `WalletMarkets`) calls the same four macros
  (`portfolioBalance`/`transactionCategorize`/`budgetCheck`/`spendingTrend`)
  through `apiHelpers.lens.runDomain('wallet', action, { input })` →
  `POST /api/lens/run` — the virtual-artifact path that needs no persisted
  id — with real textarea inputs (holdings/transactions/budget) and real
  bespoke result cards. Two UIs existed for the same four macros: one real
  and working, one fake and permanently inert.

**Fixed:** removed both dead mounts and their backing state/hooks
(`useLensData`, `useRunArtifact`, `walletItems`, `runWalletAction`,
`walletActionResult`, `walletActiveAction`, `handleWalletAction`) and the
now-unused imports (`UniversalActions`, `useLensData`, `useRunArtifact`,
`Zap`). No capability was lost — `WalletActionPanel` already covers the same
four macros correctly, and the P2P/social/split/QR/insights macros are
covered by `WalletParityHub` (see below). This is a pure dead-code removal:
123 lines net removed from `page.tsx`.

## Macro-by-macro classification

All 24 macros, cross-referenced against every `lensRun(...)` /
`apiHelpers.lens.runDomain(...)` call site in `WalletParityHub.tsx`,
`WalletActionPanel.tsx`, and `page.tsx`:

| Macro | Classification | Surfaced by |
|---|---|---|
| `portfolioBalance` | DESIGNED | `WalletActionPanel` — real holdings textarea input, bespoke portfolio card (total, per-symbol allocation %) |
| `transactionCategorize` | DESIGNED | `WalletActionPanel` — real transactions textarea, bespoke by-category breakdown |
| `budgetCheck` | DESIGNED | `WalletActionPanel` — real budget-map textarea, bespoke on-track/over card with recommendations |
| `spendingTrend` | DESIGNED | `WalletActionPanel` — bespoke trend direction + growth-category card |
| `requestList` / `requestCreate` / `requestUpdate` | DESIGNED | `WalletParityHub` Requests tab — full money-request/invoice form (line items, emoji, due date), pay/decline/cancel actions, payLink display |
| `scheduleList` / `scheduleCreate` / `scheduleUpdate` / `scheduleDelete` | DESIGNED | `WalletParityHub` Recurring tab — frequency picker, monthly-committed rollup, pause/resume/delete |
| `feedPost` / `feedList` / `feedLike` | DESIGNED | `WalletParityHub` Feed tab — visibility picker, like/comment, scope toggle (everyone/mine) |
| `splitCreate` / `splitList` / `splitSettle` | DESIGNED | `WalletParityHub` Split tab — participant list, even-split math shown live, per-member settle |
| `cardList` / `cardAdd` / `cardSetDefault` / `cardRemove` | DESIGNED | `WalletParityHub` Funding tab — card/bank/paypal type picker, last-4-only entry with explicit "never a full card number" note, default/remove |
| `qrGenerate` / `qrResolve` | DESIGNED | `WalletParityHub` QR Pay tab — real rendered QR image (qrserver.com), token copy, paste-to-resolve scan flow |
| `spendingInsights` | DESIGNED | `WalletParityHub` Insights tab — real `/api/economy/history` feed piped into the macro, `ChartKit` area + bar charts, category/trend breakdown |

**24/24 DESIGNED. 0 GENERIC-STRIP-ONLY. 0 UNSURFACED.** No macro is reached
only through a generic button wall or JSON-paste textarea — every one has a
purpose-built form and result rendering matching the wallet/fintech domain
(Venmo/PayPal-shaped tabs: Requests, Recurring, Feed, Split, Funding, QR Pay,
Insights).

## Confirmed real and already correctly wired (no changes)

Read all remaining wallet files in full;
`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/wallet/*.tsx app/lenses/wallet/page.tsx` → only one hit, a
comment in `WalletParityHub.tsx` *asserting* "No seed / mock data" (not a
fabrication signature):

- **`WalletParityHub.tsx`** (1188 lines) — the full 7-tab Payments Hub
  covering all 20 P2P macros above with real forms and real result
  rendering. No changes needed.
- **`WalletActionPanel.tsx`** — the 4-macro finance workbench (portfolio /
  categorize / budget / trend) plus mint-as-DTU / DM-to-advisor /
  publish-anonymized-insight / agent-rebalance actions, all calling real
  endpoints (`/api/lens/run`, `/api/social/dm`, `/api/dtus/:id/publish`,
  `chat_agent.do`). Correctly wired the whole time — this is the panel the
  dead top-level duplicate (defect #2 above) was shadowing.
- **`PurchaseFlow.tsx`** — real Stripe Checkout redirect
  (`POST /api/economy/buy/checkout`), preset + custom amounts, 1:1 USD peg
  display matches the constitutional peg.
- **`StripeConnectPanel.tsx`** — real Connect onboarding
  (`apiHelpers.economy.connectStripe`) + real withdrawal
  (`POST /api/economy/withdraw`), and its `PLATFORM_FEE_PERCENT = 1.46`
  was already correct (used as the reference value when fixing
  `WithdrawFlow.tsx`).
- **`WalletWidget.tsx`** — compact/full header balance widget, real
  `/api/economy/balance` read, no fabrication.
- **`WalletMarkets.tsx`** — an honest external real-world markets panel
  (live CoinGecko top-20 fetch, explicit "real-world wallet markets" label
  distinguishing it from the platform's own CC economy) — same pattern as
  other lenses' external-feed panels, no defect.
- **`page.tsx`** transaction list, infinite scroll, search/CSV export,
  sparkline, earnings summary, pending-withdrawals banner, transaction
  detail modal, inline `TransferFlow` (already correct 1.46% fee, matching
  `server/economy/fees.js#FEES.TRANSFER`) — all read from real
  `/api/economy/*` endpoints, no changes needed.

## Verification

- `node --check server/domains/wallet.js` — clean (file not modified this
  pass; read in full for the classification above, no defect found in it).
- `node --test tests/wallet-domain-parity.test.js
  tests/depth/wallet-behavior.test.js
  tests/economy/credit-debit-wallet-atomicity.test.js
  tests/economy/ledger-conservation.test.js
  tests/economy/withdrawal-earned-policy.test.js` — **43/43, 1/1, 3/3, 4/4,
  8/8 = 59/59 pass, 0 fail, unmodified** (run from `server/`).
- `npx eslint app/lenses/wallet/page.tsx components/wallet/*.tsx` (run from
  `concord-frontend/`) — clean.
- `node scripts/lens-unsurfaced.mjs --lens wallet` — `0/24 macros never
  referenced in the frontend`.

## Left alone, with reason

- **`server/domains/wallet.js`** and all of `server/economy/*` — read in
  full for verification; no defects found, and per the assignment's explicit
  constraint, withdrawal/fee/royalty economics logic itself is out of scope
  even if it were found wanting (it wasn't — `calculateFee`,
  `earnedWithdrawableBalance`, and `CREDIT_ROW_PREDICATE` all matched their
  documented constitutional values on inspection).
- **`components/economy/{TokenBalance,TransactionHistory,BountiesAndFutures,
  WalletBadge}.tsx`** — mounted on the wallet page but live in
  `components/economy/`, a shared directory used by other lenses too;
  outside this pass's file scope by the assignment brief. No fabrication
  signature was seen in their usage on this page during the read-through.
- **`globalThis._concordSTATE.walletLens` in-memory state pattern** — the
  same non-SQL, debounce-persisted STATE pattern used by several other lens
  domains for non-ledger, non-critical data (requests/schedules/feed/splits/
  cards). Not wallet-specific and not a defect to fix in this pass.
