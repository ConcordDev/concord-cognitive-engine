# Death-Insurance Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/insurance.js` — the `pact-*` macro family
> (`grep -n 'registerLensAction("insurance", "pact-' server/domains/
> insurance.js`: `pact-write`, `pact-list`, `pact-revoke`, `pact-renew`,
> `pact-set-auto-renew`, `pact-pay-premium`, `pact-premium-schedule`,
> `pact-respond`, `pact-record-payout`, `pact-payout-history`,
> `pact-notifications` — 11 macros). Frontend audited by reading
> `app/lenses/death-insurance/page.tsx` (in full) and all 6
> `components/death-insurance/*.tsx` files.

## Backend surface — 11 pact macros, all real

This lens is a distinct in-game mechanic, not a real-world insurance
product — it shares the `insurance` domain file with a separate, larger
real-world insurance lens (`/lenses/insurance`, ~60 other macros:
policies, claims, carriers, renewals, etc.) but only touches the
sparks-denominated `pact-*` family. Currency is ⚡ Sparks only — CC stays
insulated per the no-pay-to-win invariant (CLAUDE.md's marketplace-fee
constitutional invariants don't apply here; this is a distinct,
non-monetary currency).

## Reference app

No direct consumer rival — an in-game Concordia mechanic. Closest analog:
a peer-to-peer life-insurance / dead-man's-switch contract. Correctly
sparse: the lens's whole job is write-a-contract / view-two-ledgers /
revoke, which is a single-form-plus-list surface, not a data-heavy one
(per Section 1's "acceptable sparseness" carve-out).

## Audit result: no real defects found

Full read of `page.tsx` confirms real, load-bearing error handling not
present in a merely-functional lens: the `refresh()` call surfaces the
actual backend error reason (`list.data?.error`) via a `role="alert"`
banner with a retry button, rather than silently rendering an empty
workspace on failure — an explicit distinction the code's own comment
calls out ("pact-list is the load-bearing read; if it failed, surface the
real backend reason"). Empty states are honest and specific ("No pacts
yet — write one above." / "No data yet.") rather than generic "No data."

All three ledgers (written pacts, beneficiary-of pacts, payout history)
and the notification feed are populated via `Promise.all` against three
real macros (`pact-list`, `pact-notifications`, `pact-payout-history`), no
caller-fabricated data. `grep -rn "Math.random\|hardcode\|dummy"` across
the lens returns no matches.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Write contract (beneficiary/premium/payout/duration) | ALREADY REAL — `pact-write` |
| 2 | Two ledgers (written / beneficiary-of) | ALREADY REAL |
| 3 | Revoke active contract | ALREADY REAL — `pact-revoke` |
| 4 | Anti-abuse guards (beneficiary≠insured, 24h no-fire window) | ALREADY REAL — enforced server-side, documented in the page header |
| 5 | Multi-beneficiary split with percentages | ALREADY REAL (per prior wave) |
| 6 | Contract renewal / auto-renew | ALREADY REAL — `pact-renew`/`pact-set-auto-renew` |
| 7 | Recurring premium schedule | ALREADY REAL — `pact-pay-premium`/`pact-premium-schedule` |
| 8 | Beneficiary acceptance handshake | ALREADY REAL — `pact-respond` |
| 9 | Fired-payout history log | ALREADY REAL — `pact-record-payout`/`pact-payout-history` |
| 10 | Expiry/fire/premium-due notifications | ALREADY REAL — `pact-notifications` |

**Coverage summary:** 10 of 10 checklist items already real. Correctly
sparse UI for a single-mechanic lens — no padding added to manufacture
false density. No changes made this session.

## Files touched

None — audit only, no defects found.
