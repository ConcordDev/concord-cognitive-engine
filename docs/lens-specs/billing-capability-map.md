# Billing Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list:
`grep -c 'registerLensAction("billing"' server/domains/billing.js` → 23

## Reference apps

**Stripe Billing / Chargebee** — confirmed directly in source:
`SubscriptionBillingSuite.tsx:6` ("the subscription-billing core for the
billing lens... Stripe-Billing feature parity"), `server/domains/billing.js:512`
("Parity-sprint macros — subscription billing core"), and
`page.tsx:73` ("Stripe-dashboard-inspired idiom for billing surfaces").

## Audit finding: nothing wrong — real, honestly-wired SaaS billing surface

All 23 macros are real, stateful, non-stub implementations: tiered-pricing/
ASC-606/logistic-regression math (`invoiceCalculation`, `revenueRecognition`,
`churnPrediction`) with a hardened overflow guard on every finance field;
a full subscription core (plans, subscriptions, proration, cancellation,
persisted MRR/ARR); graduated-tier usage metering; coupons; a billing
portal; a real multi-jurisdiction tax table (US states, EU VAT, GB/CA/AU/JP,
B2B reverse-charge); dunning; invoicing; revenue analytics (MRR/ARR/cohort/
expansion).

`server/domains/dx-billing.js` (`billing.usage/balance/history/getCurrentQuota/
priceForMacro`) is a related-but-distinct per-call metering/quota surface for
plugin/API-key clients, registered into the canonical macro registry rather
than `LENS_ACTIONS`. It shares no action names with `billing.js` and is not
referenced anywhere in this lens's frontend — correctly out of scope, not a
decoy or an unsurfaced gap.

Frontend (`app/lenses/billing/page.tsx`, `EconomyDashboard.tsx`,
`SubscriptionBillingSuite.tsx`) calls real `apiHelpers.economy.*` endpoints
and `lensRun('billing', …)` macros throughout. Marketplace-fee text matches
the hardcoded `ECONOMIC_CONFIG` constants (constitutional invariants per
`CLAUDE.md`), not fabricated numbers. `SubscriptionBillingSuite.tsx:16`
states "Every value rendered comes from a real macro round-trip — no mock
data," and manual inspection confirms this is true for all 7 of its tabs.
No `Math.random()` in render, no hardcoded invoice/dollar fabrication in
either file.

`importsGenericTrio`/`usesGenericBody`/`hasMacroButtonWall` all fire (the
page mounts `ManifestActionBar`, `RecentMineCard`, `AutoActionStrip`,
`LensFeaturePanel`), but this is confirmed load-bearing, not dead scaffold:
`ManifestActionBar` fires real manifest actions with honest self-reporting
on no-op; `AutoActionStrip` auto-discovers genuinely-registered backend
actions via `GET /api/lens-actions/billing` with an honest empty/error
state. The grader's own `isGenericScaffold` classifier (gated on page <700
LOC AND largest component <1000 LOC) correctly returns `false` here (page
is 1123 LOC, largest component 887 LOC) — a heuristic false-positive on the
raw signal combination, not a real defect.

`node scripts/lens-unsurfaced.mjs --lens billing`:
```
billing: 0/23 macros never referenced in the frontend
```

Withdrawal flow (`earnedWithdrawableBalance`) is intentionally surfaced in
the wallet/creator lenses instead of billing — a reasonable scope split
documented in `CLAUDE.md`'s withdrawal-policy invariant, not a billing-lens
gap.

## What this rebuild changed

Nothing. No fabricated data, no broken wiring, no unsurfaced macro, and no
dead generic scaffold were found after full-file inspection of both
components and the domain file. Per the Wave 3 mandate ("if a lens's audit
genuinely finds nothing wrong, say so honestly"), this capability map
records that conclusion rather than inventing a diff.

## Verification

- No code changed; existing lint/type/wiring/grader state is unaffected.
- `node scripts/verify-lens-backends.mjs` — `billing` stays `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `billing`: `tier: "polished"`, `isGenericScaffold: false`.
