# Staking — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Reference app / category leader: Coinbase Earn / Lido**
(CEX-style flexible/locked staking products + liquid-staking receipt
tokens). The bar: would this hold up shipped standalone against Coinbase's
staking tab — multiple risk-reward pools, a rewards calculator before you
commit, a real earnings history, auto-compound, early-exit with a fee
instead of a hard wall, liquid receipts you can use elsewhere while locked
— not "good enough next to 259 siblings."

## Summary: frontend is already exemplary; the real finding is a backend
## money-integrity gap, deliberately NOT fixed this pass (see below)

This lens had clearly already been through a rebuild pass before Wave 3.
Every one of the 13 real macros in `server/domains/staking.js` is called
from a bespoke component with correct field shapes, correct envelope
handling (the shared `lensRun()` client already unwraps the single/double
`{ok,result}` wrap — see `concord-frontend/lib/api/client.ts:385-407` — so
the "fabricated success toast" class of bug that hit `kingdoms`/`poetry`/
`photography`/`personas` does not reproduce here), real loading/error/empty
states per component, and zero fabrication signatures (`Math.random`,
`MOCK`/`mock`/`fake`, Lorem, hardcoded arrays presented as live data — none
found). `node scripts/lens-unsurfaced.mjs --lens staking` reports **0/13
macros unsurfaced**.

The one substantive finding is backend-side and money-shaped, so per this
program's explicit guidance for this lens it is **flagged, not silently
patched**.

## Backend surface — TWO staking systems, only one is live

- **`server/domains/staking.js`** (13 macros, `registerLensAction`, all
  wired to the frontend) — the real, live system. Pure in-memory state on
  `globalThis._concordSTATE` (`stakingPositions`/`stakingLedger`/
  `stakingReceipts`/`stakingAprHistory` Maps keyed by userId). No `db`
  parameter is ever read or written in this file — confirmed by grep for
  `wallet|Wallet|economy_ledger|mintCoins|debit|credit|balance` returning
  zero hits.
- **`server.js:77010-77116`** (`register("staking", "stake"/"redeem"/
  "list_for_user")`, `MACROS` map, Phase 9.4 economy-primitives sprint) —
  a legacy, DB-backed system over the real `cc_stakes` table (migration
  163). **Not called by any frontend code** (confirmed: no `lensRun`/
  `lens.run` call site anywhere in `concord-frontend/`, `concord-mobile/`,
  or an MCP tool references action names `stake`/`redeem` for the
  `staking` domain — the only match is the dead `publicReadDomains.staking
  = Set(["list_for_user"])` allowlist entry at `server.js:11502`, itself
  unreachable from the UI). Action names don't collide with the live
  system (`open_stake`/`redeem_stake`/`list_positions` vs `stake`/
  `redeem`/`list_for_user`), so there's no `LENS_ACTIONS`-shadows-`MACROS`
  situation — the old system is simply orphaned, harmless dead code that
  predates the rich rebuild. **Left in place** — deleting live server.js
  registrations is out of scope for a frontend-rebuild pass per this
  program's established convention (see `personas-capability-map.md`'s
  identical disposition for its own dead `MACROS` entries).

## The real finding: neither staking system touches the wallet

**Grep-verified across the entire `server/` tree**: nothing calls
`walletDebit`/`walletCredit`/`mintCoins` for `open_stake`, `redeem_stake`,
`early_unstake`, `compound_now`, or the legacy `stake`/`redeem` pair.
Nothing references `cc_stakes` or `stakingPositions` outside
`domains/staking.js` itself and its three test files — no heartbeat
processes it either. That means:

- **`open_stake`** locks a `principalCc` number into an in-memory record
  without checking or debiting the caller's real `user_wallets` balance —
  a user can open a position for any amount, including amounts they don't
  have.
- **`redeem_stake` / `early_unstake` / `compound_now`** return principal +
  computed yield as response *data* — the frontend displays "Redeemed 1050
  CC" — but no `economy_ledger` credit or `user_wallets` update ever
  happens. The number shown is never actually paid out.

Net effect: the entire staking product is a **closed, self-consistent
simulation** layered on top of, but never connected to, the real CC
economy. It cannot be exploited to *mint* real CC (redeem doesn't touch
the wallet either, so there's no drain vector), but it directly
contradicts the page's own copy — `app/lenses/staking/page.tsx:87-89`:
*"Lock Concord Coin and earn yield from the treasury share of marketplace
fees... **Currency: CC.**"* — which asserts real money movement backed by
the real treasury, when in fact zero CC ever leaves or returns to a
wallet. This is the same defect *shape* the "honest by construction"
invariant exists to catch (a claimed capability that isn't real), except
here it sits in long-standing backend logic rather than a frontend
fabrication — it predates this rebuild pass (the legacy `cc_stakes`-backed
`stake`/`redeem` pair in `server.js`, from the original Phase 9.4 economy
sprint, has exactly the same gap, so this was never wired, not a
regression).

**Disposition: ENGINEERING, deferred to human escalation, not fixed this
pass.** Per `CLAUDE.md`'s anti-cheat section ("money/auth invariants are
human-escalation") and this task's explicit brief ("staking touches real
money/economy invariants... flag it prominently in your report rather
than silently patching a constitutional invariant"), wiring real
`walletDebit`-on-open / `walletCredit`-on-redeem into a domain that
currently has zero `db` access, then proving ledger conservation holds
under it (the existing `tests/economy/ledger-conservation.test.js`
pattern), is a cross-cutting economy change with real financial blast
radius — not a same-pass frontend-rebuild fix. **No server or frontend
code was changed for this finding.** A future dedicated economy sprint
should: (1) give `domains/staking.js` `ctx.db` access, (2) debit
`principalCc` from the caller's wallet on `open_stake` (rejecting on
insufficient balance instead of the current unconditional accept), (3)
credit principal + yield to the wallet on `redeem_stake`/`compound_now`'s
matured leg and the penalized return on `early_unstake`, (4) decide
whether APR yield is minted fresh or drawn from an actual treasury pool
(the copy already claims the latter), and (5) migrate the in-memory Maps
to the existing `cc_stakes` table (migration 163) so positions survive a
server restart — currently ALL staked positions are lost on every
process restart, a second, related honesty gap the in-memory design
creates (no persistence claim is made in the UI, so this doesn't
contradict copy the way the wallet gap does, but it means every position a
user has ever opened evaporates on deploy/restart).

## What was already real/wired (all DESIGNED)

- **`app/lenses/staking/page.tsx`** — DESIGNED. Real new-stake form (pool
  picker, principal, months, auto-compound + liquid-receipt checkboxes),
  wires `open_stake` with correct field shapes, status banner with
  auto-dismiss, composes 6 bespoke child panels plus the standard
  RecentMineCard/AutoActionStrip/CrossLensRecentsPanel row.
- **`components/staking/StakingPools.tsx`** — DESIGNED. Live `list_pools`
  card grid (flex/core/growth), risk-tone badges, APR-at-N-months preview
  driven by the parent's `months` state.
- **`components/staking/RewardsEstimator.tsx`** — DESIGNED. `estimate_rewards`
  wired with a real `ChartKit` line chart (simple vs compound balance
  over the term) plus a compound-bonus callout.
- **`components/staking/AprHistoryChart.tsx`** — DESIGNED. `apr_history`
  wired with a real `ChartKit` area chart, now/low/high summary chips,
  correctly handles the single-sample no-chart case.
- **`components/staking/StakePositions.tsx`** — DESIGNED. `list_positions`
  + `redeem_stake`/`early_unstake`/`compound_now`/`set_auto_compound`, all
  four mutations wired with correct `stakeId` shapes, busy-state per row,
  status messaging keyed to the actual response fields
  (`totalReturnCc`/`returnedCc`/`totalPenaltyCc`/`compoundedYieldCc`).
- **`components/staking/EarningsLedger.tsx`** — DESIGNED. `earnings_ledger`
  wired with a real `TimelineView` (tone-coded by ledger-entry kind) plus
  a `ChartKit` cumulative-yield area chart.
- **`components/staking/ReceiptTokens.tsx`** — DESIGNED. `list_receipts` +
  `transfer_receipt`, real inline transfer-target picker, transferable/
  status-gated action visibility.
- **`components/staking/MaturityReminders.tsx`** — DESIGNED. `maturity_reminders`
  with matured (green) vs upcoming-within-window (amber, days-left badge)
  sections.
- **`components/staking/StakingMarkets.tsx`** — DESIGNED. Real CoinGecko
  `coins/markets?category=proof-of-stake` pull (5-min refetch), real-world
  PoS market reference list with `SaveAsDtuButton` provenance-stamped
  ingest — correctly uses `useQuery`/`fetch` rather than `lensRun`, so it's
  outside the envelope-unwrap risk entirely.

All 13 domain macros are reached through these bespoke, correctly-wired
surfaces — nothing is GENERIC-STRIP-ONLY or UNSURFACED.

## Investigated and confirmed clean (no fix needed)

- **Envelope handling** — every component checks `r.data?.ok` /
  `r.data.result`, which is safe because `lensRun()` itself already
  normalizes both the single- and double-wrapped `{ok,result}` shape
  before returning (`concord-frontend/lib/api/client.ts:387-406`, a
  shared fix that predates this pass). No component-level envelope bug
  exists in this lens.
- **Field-shape parity** — every `lensRun('staking', <action>, {...})` call
  site's params match the macro's `params.*` reads exactly (`poolId`,
  `principalCc`, `months`, `autoCompound`, `liquidReceipt`, `stakeId`,
  `enabled`, `receiptId`, `toUserId`, `windowDays`, `limit`). No shape
  mismatches found.
- **Generic-CRUD substitution** — no `useLensData`/`useRunArtifact` usage
  anywhere in the lens; the `lib/lenses/manifest.ts` entry for `staking`
  (`actions: ['stake','redeem']`, `macros: {list:'lens.staking.list',...}`)
  is unused dead metadata — grep confirms no component reads
  `getLensManifest('staking').actions` or `.macros` to drive a generic
  action wall or a parallel fetch path; only `FirstRunTour` reads this
  lens's manifest, and only for `firstRunGuide.steps` (unrelated field).
  Left alone: editing shared manifest infrastructure is out of scope and
  the stale field renders nothing.
- **Fabrication signatures** — `Math.random`, `MOCK`, `mock`, `fake`,
  `Lorem`/`lorem`, hardcoded-array-as-live-data: zero hits across
  `app/lenses/staking/page.tsx` and `components/staking/*.tsx`.

## Category-leadership caliber judgment (fourth invariant)

Against Coinbase Earn / Lido specifically: multiple risk-reward pools,
a pre-commit rewards calculator with a simple-vs-compound chart, a real
earnings ledger with a cumulative-yield timeline, auto-compound,
early-exit-with-penalty (Coinbase's own liquidity-with-fee shape, not a
hard lock), and liquid-staking receipt tokens together cover the full
leader feature set at real UI quality — this is not a thin clone. **The
one place it doesn't hold up standalone is the exact finding above**: a
leader's staking tab moves real balance; this one currently doesn't move
any. That gap is squarely why this isn't rated fully caliber-equal yet,
and it's also why it's flagged rather than papered over.

## Verification

- `node --check server/domains/staking.js` — clean (backend untouched this
  pass).
- `node --test server/tests/staking-lens-macros.test.js
  server/tests/staking-domain-parity.test.js
  server/tests/depth/staking-behavior.test.js` → **32 tests / 23 suites,
  32 pass, 0 fail** (backend untouched; re-verified green).
- `cd concord-frontend && npx eslint app/lenses/staking/page.tsx
  components/staking/*.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — staking WIRED (not in
  the 2 by-design exceptions).
- `node scripts/lens-unsurfaced.mjs --lens staking` → `0/13 macros never
  referenced in the frontend`.
- `node scripts/grade-ux-polish.mjs --honest` → staking entry:
  `tier: "polished"`, `isGenericScaffold: false`, `pillarsPresent: 5`,
  `bespokeRatio: 0.811` (`totalLoc: 1211`, `bespokeComponentLoc: 982`).
  `audit/` reverted after the run.

## Left alone, with reason

- **No frontend or backend code changed this pass.** The frontend is
  already fully DESIGNED and correctly wired to the real macro set; the
  one real defect (wallet non-integration) is a cross-cutting economy
  change with real financial blast radius, explicitly out of scope for a
  same-pass fix per this program's money-invariant guidance. See the
  finding section above for the concrete follow-up plan.
- **Legacy `server.js:77010-77083` `stake`/`redeem`/`list_for_user`
  `MACROS` registrations** — confirmed dead (unreachable from any known
  frontend/mobile/MCP call site), left in place; removing live server.js
  code is out of scope for a frontend-rebuild pass (same disposition this
  program has taken for other lenses' confirmed-dead-but-harmless
  registrations).
- **`docs/lens-specs/staking.md`** (pre-existing spec doc) — left as-is;
  it names the legacy macro set (`stake`/`redeem`/`list_for_user`) as "Has
  (verified in code)" when the live surface is actually the richer
  `open_stake`/`redeem_stake`/`list_positions`/etc. set — stale but this
  capability-map doc supersedes it per this program's convention of not
  hand-editing older per-lens spec files during a rebuild pass.
